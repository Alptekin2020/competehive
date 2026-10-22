import * as cheerio from "cheerio";

import { cleanImageUrl, fetchWithTimeout, parsePrice, type ScrapedProduct } from "@/lib/scraper";

// Bağımsız mağaza siteleri (satıcının kendi sitesi) için fiyat okuma + teşhis.
// Pazaryeri scraper'larının aksine burada sitenin yapısını önceden bilmiyoruz;
// bu yüzden sonuç yalnızca ürün verisi değil, kullanıcıya gösterilecek bir
// "destek seviyesi" ve nedenleri de içerir. Ürün ekleme önizlemesi ve POST
// /api/products aynı fonksiyonu kullanır — önizlemede "uygun" görünen site
// eklemede reddedilmesin.

export type StoreSupportLevel = "full" | "partial" | "unsupported";

export interface StoreProduct extends ScrapedProduct {
  sku: string | null;
  gtin: string | null;
  brand: string | null;
}

export interface StorePageResult {
  support: StoreSupportLevel;
  /** User-facing (Turkish) explanations; empty when support is "full". */
  issues: string[];
  product: StoreProduct;
}

type JsonNode = Record<string, unknown>;

const IN_STOCK_RE = /instock|in stock|limitedavailability|instoreonly|onlineonly|preorder|presale/i;
const OUT_OF_STOCK_RE = /outofstock|out of stock|soldout|sold out|discontinued/i;

function emptyProduct(): StoreProduct {
  return {
    name: "",
    price: null,
    currency: "TRY",
    image: null,
    seller: null,
    inStock: true,
    sku: null,
    gtin: null,
    brand: null,
  };
}

function hasType(node: JsonNode, ...types: string[]): boolean {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.some((t) => typeof t === "string" && types.includes(t));
}

/** Depth-first search for the first Product/ProductGroup node in a JSON-LD tree. */
function findProductNode(value: unknown, depth = 0): JsonNode | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const node = value as JsonNode;
  if (hasType(node, "Product", "ProductGroup")) return node;
  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    const found = findProductNode(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstOffer(product: JsonNode): JsonNode | null {
  const pick = (offers: unknown): JsonNode | null => {
    const first = Array.isArray(offers) ? offers[0] : offers;
    return first && typeof first === "object" ? (first as JsonNode) : null;
  };
  const direct = pick(product.offers);
  if (direct) return direct;
  // ProductGroup: fiyat varyantlarda durur — ilk varyantın teklifi alınır.
  const variants = product.hasVariant;
  const variant = Array.isArray(variants) ? variants[0] : variants;
  if (variant && typeof variant === "object") return pick((variant as JsonNode).offers);
  return null;
}

function stockFrom(value: string | null): boolean | null {
  if (!value) return null;
  if (OUT_OF_STOCK_RE.test(value)) return false;
  if (IN_STOCK_RE.test(value)) return true;
  return null;
}

/**
 * Pure HTML → product + support diagnosis. Order: JSON-LD (schema.org
 * Product), then Open Graph/product meta tags, then microdata (itemprop).
 */
export function parseStorePage(html: string): StorePageResult {
  const $ = cheerio.load(html);
  const product = emptyProduct();
  let stock: boolean | null = null;
  let currency: string | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (product.price !== null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).html() || "");
    } catch {
      // Bozuk JSON-LD bloğu: sayfadaki diğer bloklar ve meta etiketleri denenir.
      return;
    }
    const node = findProductNode(parsed);
    if (!node) return;

    if (!product.name) product.name = asString(node.name) ?? "";
    if (!product.image) product.image = cleanImageUrl(node.image);
    product.sku ??= asString(node.sku);
    product.gtin ??= asString(node.gtin13) ?? asString(node.gtin) ?? asString(node.gtin8);
    const brand = node.brand;
    product.brand ??=
      asString(brand) ??
      (brand && typeof brand === "object" ? asString((brand as JsonNode).name) : null);

    const offer = firstOffer(node);
    if (!offer) return;
    const rawPrice = asString(offer.price) ?? asString(offer.lowPrice);
    const price = rawPrice ? parsePrice(rawPrice) : null;
    if (price !== null && price > 0) product.price = price;
    currency ??= asString(offer.priceCurrency);
    stock ??= stockFrom(asString(offer.availability));
    if (!product.seller && offer.seller && typeof offer.seller === "object") {
      product.seller = asString((offer.seller as JsonNode).name);
    }
  });

  const meta = (selector: string) => asString($(selector).first().attr("content"));
  const itemprop = (name: string) => {
    const el = $(`[itemprop="${name}"]`).first();
    if (!el.length) return null;
    return asString(el.attr("content")) ?? asString(el.attr("href")) ?? asString(el.text());
  };

  if (product.price === null) {
    const rawPrice =
      meta('meta[property="product:price:amount"]') ??
      meta('meta[property="og:price:amount"]') ??
      itemprop("price");
    const price = rawPrice ? parsePrice(rawPrice) : null;
    if (price !== null && price > 0) product.price = price;
  }
  currency ??=
    meta('meta[property="product:price:currency"]') ??
    meta('meta[property="og:price:currency"]') ??
    itemprop("priceCurrency");
  stock ??= stockFrom(meta('meta[property="product:availability"]') ?? itemprop("availability"));

  if (!product.name) {
    product.name =
      meta('meta[property="og:title"]') ??
      asString($("h1").first().text()) ??
      asString($("title").first().text()) ??
      "";
  }
  if (!product.image) product.image = meta('meta[property="og:image"]');

  product.currency = (currency ?? "TRY").toUpperCase();
  product.inStock = stock ?? true;

  const issues: string[] = [];
  if (product.price === null) {
    issues.push(
      detectBotChallenge(html)
        ? "Site otomatik erişimi engelliyor (bot koruması)."
        : "Sayfada okunabilir bir fiyat bilgisi bulunamadı. Fiyat sayfaya sonradan JavaScript ile yükleniyor ya da ürün verisi standart formatta değil.",
    );
    return { support: "unsupported", issues, product };
  }
  if (!product.name) issues.push("Ürün adı okunamadı.");
  if (stock === null) issues.push("Stok durumu okunamadı; ürün stokta kabul edilecek.");
  if (product.currency !== "TRY") {
    issues.push(`Fiyat TL dışında bir para biriminde (${product.currency}).`);
  }
  return { support: issues.length > 0 ? "partial" : "full", issues, product };
}

function detectBotChallenge(html: string): boolean {
  return /cf-chl|challenge-platform|Just a moment\.\.\.|_Incapsula_Resource|px-captcha|captcha-delivery/i.test(
    html.slice(0, 50_000),
  );
}

const SSRF_MESSAGES = new Set([
  "Geçersiz URL",
  "Yalnızca http/https destekleniyor",
  "Bu adres erişime kapalı",
  "Alan adı çözümlenemedi",
]);

function unsupported(issue: string): StorePageResult {
  return { support: "unsupported", issues: [issue], product: emptyProduct() };
}

/**
 * Fetch an independent store's product page (SSRF-guarded, redirects
 * re-validated per hop) and diagnose whether its price can be tracked.
 * Never throws: failures come back as support="unsupported" with a reason.
 */
export async function scrapeStorePage(url: string): Promise<StorePageResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (SSRF_MESSAGES.has(message)) return unsupported(`Bu adrese erişilemiyor: ${message}.`);
    return unsupported("Siteye ulaşılamadı (zaman aşımı veya bağlantı hatası).");
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 410) {
      return unsupported(`Ürün sayfası bulunamadı (HTTP ${res.status}).`);
    }
    if ([401, 403, 429, 503].includes(res.status)) {
      return unsupported(`Site otomatik erişimi engelliyor (HTTP ${res.status}).`);
    }
    return unsupported(`Site beklenmeyen bir yanıt döndü (HTTP ${res.status}).`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("html")) {
    return unsupported("Bu link bir ürün sayfasına ait değil.");
  }

  return parseStorePage(await res.text());
}
