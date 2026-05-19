// Audit P0-1: When Serper returns a Hepsiburada/Trendyol shopping result without
// a `price` (Akamai often blocks the Google price feed), this helper recovers it
// via a lightweight HTTP fetch + cheerio parse. Tries JSON-LD, __NEXT_DATA__, OG
// meta tags, and data-test-id selectors in order. Returns null on Akamai block or
// HTTP failure so callers can decide whether to escalate to Puppeteer.
//
// Intentionally does NOT use Puppeteer here: competitor discovery returns ~20
// candidates per product, and spinning up a browser per candidate would saturate
// the worker. We pay the Puppeteer cost only in the existing scrape flow.

import * as cheerio from "cheerio";
import { parsePrice } from "../serper";

export type PriceRecoveryResult = {
  price: number | null;
  source:
    | "jsonld"
    | "nextdata"
    | "og-meta"
    | "data-testid"
    | "none"
    | "http-error"
    | "akamai-block";
};

const FETCH_TIMEOUT_MS = 7000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parsePriceFromJsonLd(html: string): number | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).text();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const candidates = Array.isArray(data) ? data : [data];
      for (const node of candidates) {
        const offers = node?.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const offer of offerList) {
          const priceField =
            offer?.price ?? offer?.priceSpecification?.price ?? offer?.lowPrice ?? offer?.highPrice;
          if (priceField === undefined || priceField === null) continue;
          const parsed = parsePrice(String(priceField));
          if (parsed && parsed > 0) return parsed;
        }
      }
    } catch {
      // Malformed JSON-LD payload. Try the next one.
    }
  }
  return null;
}

function parsePriceFromMeta(html: string): number | null {
  const $ = cheerio.load(html);
  const ogPrice = $('meta[property="product:price:amount"]').attr("content");
  if (ogPrice) {
    const parsed = parsePrice(ogPrice);
    if (parsed && parsed > 0) return parsed;
  }
  const itempropPrice = $('meta[itemprop="price"]').attr("content");
  if (itempropPrice) {
    const parsed = parsePrice(itempropPrice);
    if (parsed && parsed > 0) return parsed;
  }
  return null;
}

function parsePriceFromNextData(html: string): number | null {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const visited = new WeakSet<object>();
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (visited.has(node as object)) continue;
      visited.add(node as object);
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (typeof value === "number" && (/price/i.test(key) || /amount/i.test(key)) && value > 0) {
          return value;
        }
        if (typeof value === "string" && /price/i.test(key) && value.length < 32) {
          const parsed = parsePrice(value);
          if (parsed && parsed > 0) return parsed;
        }
        if (value && typeof value === "object") {
          stack.push(value);
        }
      }
    }
  } catch {
    // Malformed __NEXT_DATA__ payload.
  }
  return null;
}

function parsePriceFromDataTestId(html: string): number | null {
  const $ = cheerio.load(html);
  const selectors = [
    '[data-test-id="price-current-price"]',
    '[data-test-id="default-price"]',
    '[data-test-id="price"]',
    ".product-price .price",
    ".prc-dsc",
    ".product-price",
    ".price",
  ];
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (!text) continue;
    const parsed = parsePrice(text);
    if (parsed && parsed > 0) return parsed;
  }
  return null;
}

function isAkamaiBlock(html: string, status: number): boolean {
  if (status === 403 || status === 429) return true;
  if (!html) return false;
  const lower = html.toLowerCase();
  if (lower.includes("access denied")) return true;
  if (lower.includes("akamai")) return true;
  if (lower.includes("reference #")) return true;
  return false;
}

export async function recoverPriceLightweight(url: string): Promise<PriceRecoveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
    });
    const html = await res.text();
    if (isAkamaiBlock(html, res.status)) {
      return { price: null, source: "akamai-block" };
    }
    if (!res.ok) {
      return { price: null, source: "http-error" };
    }
    const fromJsonLd = parsePriceFromJsonLd(html);
    if (fromJsonLd) return { price: fromJsonLd, source: "jsonld" };
    const fromNextData = parsePriceFromNextData(html);
    if (fromNextData) return { price: fromNextData, source: "nextdata" };
    const fromMeta = parsePriceFromMeta(html);
    if (fromMeta) return { price: fromMeta, source: "og-meta" };
    const fromDataTestId = parsePriceFromDataTestId(html);
    if (fromDataTestId) return { price: fromDataTestId, source: "data-testid" };
    return { price: null, source: "none" };
  } catch {
    return { price: null, source: "http-error" };
  } finally {
    clearTimeout(timeout);
  }
}
