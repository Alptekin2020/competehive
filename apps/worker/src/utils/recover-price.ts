// Audit P0-1: When Serper returns a Hepsiburada/Trendyol shopping result without
// a `price` (Akamai often blocks the Google price feed), this helper recovers it
// via a lightweight HTTP fetch + cheerio parse. Tries JSON-LD, __NEXT_DATA__, OG
// meta tags, and data-test-id selectors in order. Returns null on Akamai block or
// HTTP failure so callers can decide whether to escalate to Puppeteer.
//
// Intentionally does NOT use Puppeteer here: competitor discovery returns ~20
// candidates per product, and spinning up Puppeteer for each would saturate the
// Railway worker.

import * as cheerio from "cheerio";
import { logger } from "./logger";
import { parsePrice } from "../serper";

const RECOVERY_TIMEOUT_MS = 6000;
const RECOVERY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface PriceRecoveryResult {
  price: number | null;
  source:
    | "json-ld"
    | "meta-og"
    | "next-data"
    | "data-test-id"
    | "akamai-blocked"
    | "http-error"
    | "no-match"
    | "timeout";
}

function parsePriceFromJsonLd($: cheerio.CheerioAPI): number | null {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const text = $(scripts[i]).html();
    if (!text) continue;
    try {
      const data = JSON.parse(text);
      const candidates: unknown[] = Array.isArray(data) ? data : [data];
      const graph = (data as Record<string, unknown>)["@graph"];
      if (Array.isArray(graph)) candidates.push(...graph);

      for (const node of candidates) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        if (n["@type"] !== "Product") continue;
        const offers = n.offers;
        const offer = (Array.isArray(offers) ? offers[0] : offers) as
          | Record<string, unknown>
          | undefined;
        if (!offer) continue;
        const raw = offer.price ?? offer.lowPrice ?? offer.highPrice;
        if (raw == null) continue;
        const num = typeof raw === "number" ? raw : parsePrice(String(raw));
        if (num && num > 0) return num;
      }
    } catch {
      // malformed JSON-LD - skip
    }
  }
  return null;
}

function parsePriceFromMeta($: cheerio.CheerioAPI): number | null {
  const candidates = [
    $('meta[property="product:price:amount"]').attr("content"),
    $('meta[property="product:sale_price:amount"]').attr("content"),
    $('meta[property="og:price:amount"]').attr("content"),
    $('meta[itemprop="price"]').attr("content"),
    $('meta[name="price"]').attr("content"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const num = parsePrice(c);
    if (num && num > 0) return num;
  }
  return null;
}

function parsePriceFromNextData($: cheerio.CheerioAPI): number | null {
  const raw = $("script#__NEXT_DATA__").html();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const text = JSON.stringify(data);
    const keys = [
      "discountedPrice",
      "sellingPrice",
      "finalPrice",
      "offeredPrice",
      "salePrice",
      "currentPrice",
    ];
    for (const key of keys) {
      const re = new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`);
      const m = text.match(re);
      if (m) {
        const num = parseFloat(m[1]);
        if (num > 0) return num;
      }
    }
  } catch {
    /* malformed */
  }
  return null;
}

function parsePriceFromDataTestId($: cheerio.CheerioAPI): number | null {
  const selectors = [
    '[data-test-id="price-current-price"]',
    '[data-test-id="default-price"]',
    '[data-test-id="price"]',
    '[data-test-id="offering-price"]',
    '[data-testid="price-current-price"]',
    '[data-testid="default-price"]',
    "[class*='prc-dsc']",
    "[class*='priceContainer']",
  ];
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (!text) continue;
    const num = parsePrice(text);
    if (num && num > 0) return num;
  }
  return null;
}

function isAkamaiBlock(html: string, status: number, server: string | null): boolean {
  if (status === 403 && server && server.toLowerCase().includes("akamai")) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("hepsiburada | guvenlik") ||
    (lower.includes("akamai") && lower.includes("iframe"))
  );
}

export async function recoverPriceLightweight(competitorUrl: string): Promise<PriceRecoveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOVERY_TIMEOUT_MS);

  try {
    const res = await fetch(competitorUrl, {
      headers: {
        "User-Agent": RECOVERY_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const server = res.headers.get("server");
    const html = await res.text();

    if (isAkamaiBlock(html, res.status, server)) {
      logger.info(
        { url: competitorUrl.slice(0, 80), status: res.status, server },
        "recoverPrice: Akamai block - caller should consider scraper fallback",
      );
      return { price: null, source: "akamai-blocked" };
    }

    if (!res.ok) {
      return { price: null, source: "http-error" };
    }

    const $ = cheerio.load(html);

    const jsonLd = parsePriceFromJsonLd($);
    if (jsonLd) return { price: jsonLd, source: "json-ld" };

    const nextData = parsePriceFromNextData($);
    if (nextData) return { price: nextData, source: "next-data" };

    const meta = parsePriceFromMeta($);
    if (meta) return { price: meta, source: "meta-og" };

    const dom = parsePriceFromDataTestId($);
    if (dom) return { price: dom, source: "data-test-id" };

    return { price: null, source: "no-match" };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("abort")) {
      return { price: null, source: "timeout" };
    }
    return { price: null, source: "http-error" };
  }
}
// Audit P0-1: Serper Hepsiburada/Trendyol için sık sık price alanını boş döndürür
// (Akamai Google'a price feed vermiyor). Bu helper, fiyat boş geldiğinde:
//   1) Lightweight HTTP + cheerio ile JSON-LD/meta tag/__NEXT_DATA__/data-test-id selectors deniyor.
//   2) Akamai ile karşılaşırsa veya HTTP başarısız olursa null döner — caller scrapeHepsiburada
//      gibi pahalı Puppeteer path'ine fallback edip etmeyeceğine kendisi karar verir.
//
// Bu dosya BİLEREK Puppeteer kullanmıyor: rakip keşif akışında ürün başına ~20 sonuç
// dönüyor, hepsi için Puppeteer açmak Railway worker'ı boğar.

import * as cheerio from "cheerio";
import { logger } from "./logger";
import { parsePrice } from "../serper";

const RECOVERY_TIMEOUT_MS = 6000;
const RECOVERY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface PriceRecoveryResult {
  price: number | null;
  source:
    | "json-ld"
    | "meta-og"
    | "next-data"
    | "data-test-id"
    | "akamai-blocked"
    | "http-error"
    | "no-match"
    | "timeout";
}

function parsePriceFromJsonLd($: cheerio.CheerioAPI): number | null {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const text = $(scripts[i]).html();
    if (!text) continue;
    try {
      const data = JSON.parse(text);
      const candidates: unknown[] = Array.isArray(data) ? data : [data];
      const graph = (data as Record<string, unknown>)["@graph"];
      if (Array.isArray(graph)) candidates.push(...graph);

      for (const node of candidates) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        if (n["@type"] !== "Product") continue;
        const offers = n.offers;
        const offer = (Array.isArray(offers) ? offers[0] : offers) as
          | Record<string, unknown>
          | undefined;
        if (!offer) continue;
        const raw = offer.price ?? offer.lowPrice ?? offer.highPrice;
        if (raw == null) continue;
        const num = typeof raw === "number" ? raw : parsePrice(String(raw));
        if (num && num > 0) return num;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

function parsePriceFromMeta($: cheerio.CheerioAPI): number | null {
  const candidates = [
    $('meta[property="product:price:amount"]').attr("content"),
    $('meta[property="product:sale_price:amount"]').attr("content"),
    $('meta[property="og:price:amount"]').attr("content"),
    $('meta[itemprop="price"]').attr("content"),
    $('meta[name="price"]').attr("content"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const num = parsePrice(c);
    if (num && num > 0) return num;
  }
  return null;
}

function parsePriceFromNextData($: cheerio.CheerioAPI): number | null {
  const raw = $("script#__NEXT_DATA__").html();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const text = JSON.stringify(data);
    // Common keys across Trendyol/Hepsiburada
    const keys = [
      "discountedPrice",
      "sellingPrice",
      "finalPrice",
      "offeredPrice",
      "salePrice",
      "currentPrice",
    ];
    for (const key of keys) {
      const re = new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`);
      const m = text.match(re);
      if (m) {
        const num = parseFloat(m[1]);
        if (num > 0) return num;
      }
    }
  } catch {
    /* malformed */
  }
  return null;
}

function parsePriceFromDataTestId($: cheerio.CheerioAPI): number | null {
  const selectors = [
    '[data-test-id="price-current-price"]',
    '[data-test-id="default-price"]',
    '[data-test-id="price"]',
    '[data-test-id="offering-price"]',
    '[data-testid="price-current-price"]',
    '[data-testid="default-price"]',
    "[class*='prc-dsc']", // Trendyol price class
    "[class*='priceContainer']",
  ];
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (!text) continue;
    const num = parsePrice(text);
    if (num && num > 0) return num;
  }
  return null;
}

function isAkamaiBlock(html: string, status: number, server: string | null): boolean {
  if (status === 403 && server && server.toLowerCase().includes("akamai")) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("hepsiburada | güvenlik") ||
    lower.includes("hepsiburada | guvenlik") ||
    (lower.includes("akamai") && lower.includes("iframe"))
  );
}

/**
 * Lightweight HTTP-only price recovery. Returns null on Akamai block, HTTP failure,
 * or when no price marker is found. Caller decides whether to escalate to Puppeteer.
 */
export async function recoverPriceLightweight(competitorUrl: string): Promise<PriceRecoveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOVERY_TIMEOUT_MS);

  try {
    const res = await fetch(competitorUrl, {
      headers: {
        "User-Agent": RECOVERY_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const server = res.headers.get("server");
    const html = await res.text();

    if (isAkamaiBlock(html, res.status, server)) {
      logger.info(
        { url: competitorUrl.slice(0, 80), status: res.status, server },
        "recoverPrice: Akamai block — caller should consider scraper fallback",
      );
      return { price: null, source: "akamai-blocked" };
    }

    if (!res.ok) {
      return { price: null, source: "http-error" };
    }

    const $ = cheerio.load(html);

    const jsonLd = parsePriceFromJsonLd($);
    if (jsonLd) return { price: jsonLd, source: "json-ld" };

    const nextData = parsePriceFromNextData($);
    if (nextData) return { price: nextData, source: "next-data" };

    const meta = parsePriceFromMeta($);
    if (meta) return { price: meta, source: "meta-og" };

    const dom = parsePriceFromDataTestId($);
    if (dom) return { price: dom, source: "data-test-id" };

    return { price: null, source: "no-match" };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("abort")) {
      return { price: null, source: "timeout" };
    }
    return { price: null, source: "http-error" };
  }
}

