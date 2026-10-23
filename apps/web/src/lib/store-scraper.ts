import * as cheerio from "cheerio";

import { parseAvailability } from "@competehive/shared";
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

const STOCK_UNKNOWN_ISSUE = "Stok durumu okunamadı; ürün stokta kabul edilecek.";

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
    stock ??= parseAvailability(asString(offer.availability));
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
  stock ??= parseAvailability(
    meta('meta[property="product:availability"]') ??
      meta('meta[property="og:availability"]') ??
      itemprop("availability"),
  );

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
  if (stock === null) issues.push(STOCK_UNKNOWN_ISSUE);
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

// Shopify ürün yolu: /products/<handle>, isteğe bağlı dil öneki
// (/en/products/…) veya koleksiyon öneki (/collections/x/products/…).
const SHOPIFY_PRODUCT_PATH =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products\/([^/?#]+)/i;

/** `/products/<handle>.js` JSON endpoint for a Shopify-style product URL, else null. */
export function shopifyJsonUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(SHOPIFY_PRODUCT_PATH);
    if (!match) return null;
    const handle = match[1].replace(/\.(js|json)$/i, "");
    return `${parsed.origin}/products/${handle}.js`;
  } catch {
    return null;
  }
}

/**
 * Parse Shopify's public `/products/<handle>.js` payload. Prices there are in
 * the shop currency's minor unit (kuruş); the currency itself isn't included,
 * so TRY is assumed for Turkish shops.
 */
export function parseShopifyProductJson(data: unknown): StorePageResult | null {
  if (!data || typeof data !== "object") return null;
  const json = data as JsonNode;
  const cents = typeof json.price === "number" ? json.price : Number(json.price);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const variants = Array.isArray(json.variants) ? (json.variants as JsonNode[]) : [];
  const image = asString(json.featured_image);
  const product: StoreProduct = {
    ...emptyProduct(),
    name: asString(json.title) ?? "",
    price: Math.round(cents) / 100,
    image: image?.startsWith("//") ? `https:${image}` : image,
    inStock: json.available !== false,
    sku: asString(variants[0]?.sku),
    gtin: asString(variants[0]?.barcode),
    brand: asString(json.vendor),
  };
  return {
    support: product.name ? "full" : "partial",
    issues: product.name ? [] : ["Ürün adı okunamadı."],
    product,
  };
}

async function tryShopifyJson(url: string): Promise<StorePageResult | null> {
  const jsonUrl = shopifyJsonUrl(url);
  if (!jsonUrl) return null;
  try {
    // Shopify mağazaları HTML sayfasını sunucu istemcilerine sık sık 429
    // (Cloudflare bot yönetimi) ile döndürür; JSON ucu ise açıktır — ama
    // yalnızca JSON Accept başlığıyla.
    const res = await fetchWithTimeout(jsonUrl, 10000, 3, {
      accept: "application/json",
      userAgent: STORE_USER_AGENT,
    });
    if (!res.ok) return null;
    return parseShopifyProductJson(await res.json());
  } catch {
    // Shopify olmayan bir sitenin /products/… yolu: JSON yok, HTML teşhisi geçerli.
    return null;
  }
}

// Bağımsız mağazalara kendimizi dürüstçe tanıtırız. Cloudflare (Shopify vb.),
// "Chrome" diyen ama Node TLS parmak izi taşıyan istekleri 429'la reddediyor;
// tanımlı bir bot kimliği ise geçiyor. Kimliğimizi engelleyen siteler için
// tarayıcı kimliğiyle bir kez daha denenir.
export const STORE_USER_AGENT = "CompeteHive/1.0 (+https://competehive.com)";
const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);

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
 * re-validated per hop) and diagnose whether its price can be tracked. When
 * the HTML can't be read, Shopify-style URLs fall back to the product JSON.
 * Never throws: failures come back as support="unsupported" with a reason.
 */
export async function scrapeStorePage(url: string): Promise<StorePageResult> {
  const fromHtml = await scrapeStoreHtml(url);
  if (fromHtml.support === "full") return fromHtml;
  const fromJson = await tryShopifyJson(url);
  if (!fromJson) return fromHtml;
  if (fromHtml.support === "unsupported") return fromJson;
  // Fiyat HTML'den okundu ama stok okunamadı: Shopify JSON'undaki `available`
  // ile tamamlanır (HTML'deki para birimi/fiyat korunur).
  if (!fromHtml.issues.includes(STOCK_UNKNOWN_ISSUE)) return fromHtml;
  const issues = fromHtml.issues.filter((issue) => issue !== STOCK_UNKNOWN_ISSUE);
  return {
    support: issues.length > 0 ? "partial" : "full",
    issues,
    product: { ...fromHtml.product, inStock: fromJson.product.inStock },
  };
}

async function scrapeStoreHtml(url: string): Promise<StorePageResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, 10000, 3, { userAgent: STORE_USER_AGENT });
    if (BLOCKED_STATUSES.has(res.status)) res = await fetchWithTimeout(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (SSRF_MESSAGES.has(message)) return unsupported(`Bu adrese erişilemiyor: ${message}.`);
    return unsupported("Siteye ulaşılamadı (zaman aşımı veya bağlantı hatası).");
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 410) {
      return unsupported(`Ürün sayfası bulunamadı (HTTP ${res.status}).`);
    }
    if (BLOCKED_STATUSES.has(res.status)) {
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
