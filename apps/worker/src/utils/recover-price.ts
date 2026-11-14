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
import { isMarketplaceProductUrl, parsePrice } from "../serper";

export type PriceRecoveryResult = {
  price: number | null;
  source:
    | "jsonld"
    | "nextdata"
    | "og-meta"
    | "data-testid"
    | "none"
    | "http-error"
    | "akamai-block"
    | "not-product-page";
};

const FETCH_TIMEOUT_MS = 7000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type JsonLdNode = Record<string, unknown>;

function isProductNode(node: JsonLdNode): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type === "Product";
  return Array.isArray(type) && type.includes("Product");
}

/** JSON-LD bloklarındaki üst düzey düğümler (dizi ve @graph açılmış). */
function collectJsonLdNodes(html: string): JsonLdNode[] {
  const $ = cheerio.load(html);
  const nodes: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const data: unknown = JSON.parse(raw);
      const top = Array.isArray(data) ? data : [data];
      for (const item of top) {
        if (!item || typeof item !== "object") continue;
        nodes.push(item as JsonLdNode);
        const graph = (item as JsonLdNode)["@graph"];
        if (Array.isArray(graph)) {
          for (const g of graph) if (g && typeof g === "object") nodes.push(g as JsonLdNode);
        }
      }
    } catch (err) {
      // Bozuk JSON-LD bloğu: diğer bloklar hâlâ geçerli olabilir, atla.
      void err;
    }
  });
  return nodes;
}

/**
 * Sayfa tek bir ürünün sayfası değil de liste/kategori sayfası mı?
 * Prod vakası (14 Kasım): Hepsiburada yayından kalkmış `-pm-` ilanlarını
 * kategori sayfasına yönlendiriyor; eski kod o sayfadaki İLK ürünün fiyatını
 * (126,65 ₺) üç farklı rakibe "kurtarılmış fiyat" olarak yazdı ve 299,90 ₺'lik
 * ürün için sahte "rakip %58 ucuz" tablosu üretti.
 */
export function looksLikeListingPage(html: string): boolean {
  const nodes = collectJsonLdNodes(html);
  if (nodes.some((n) => n["@type"] === "ItemList" || n["@type"] === "CollectionPage")) return true;
  const names = new Set(
    nodes
      .filter(isProductNode)
      .map((n) => (typeof n.name === "string" ? n.name.trim().toLowerCase() : ""))
      .filter(Boolean),
  );
  return names.size > 1;
}

/**
 * İstek ürün sayfasından başka bir yere mi yönlendi? Bilinen pazaryerlerinde
 * ürün URL kalıbı kaybolduysa (kategori/arama/ana sayfa) fiyat okunmaz.
 */
export function leftProductPage(requestedUrl: string, finalUrl: string): boolean {
  if (!finalUrl || finalUrl === requestedUrl) return false;
  return isMarketplaceProductUrl(requestedUrl) && !isMarketplaceProductUrl(finalUrl);
}

/** Yalnızca `Product` düğümlerinin teklif fiyatı kabul edilir. */
export function parsePriceFromJsonLd(html: string): number | null {
  for (const node of collectJsonLdNodes(html)) {
    if (!isProductNode(node)) continue;
    const offers = node.offers;
    if (!offers) continue;
    const offerList = (Array.isArray(offers) ? offers : [offers]) as JsonLdNode[];
    for (const offer of offerList) {
      const spec = offer?.priceSpecification as JsonLdNode | undefined;
      const priceField = offer?.price ?? spec?.price ?? offer?.lowPrice ?? offer?.highPrice;
      if (priceField === undefined || priceField === null) continue;
      const parsed = parsePrice(String(priceField));
      if (parsed && parsed > 0) return parsed;
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
    if (leftProductPage(url, res.url) || looksLikeListingPage(html)) {
      return { price: null, source: "not-product-page" };
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
