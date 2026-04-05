import * as cheerio from "cheerio";

export interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  image: string | null;
  seller: string | null;
  inStock: boolean;
}

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Turkish: 1.299,00 → comma is decimal
      const num = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
      return isNaN(num) ? null : num;
    } else {
      // International: 1,299.00 → dot is decimal
      const num = parseFloat(cleaned.replace(/,/g, ""));
      return isNaN(num) ? null : num;
    }
  } else if (hasComma && !hasDot) {
    // Only comma: "472,00" → comma is decimal (Turkish)
    const num = parseFloat(cleaned.replace(",", "."));
    return isNaN(num) ? null : num;
  } else if (hasDot && !hasComma) {
    // Only dot: need to determine if decimal or thousands
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // "472.00" or "1299.9" → dot is decimal (international format)
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    } else {
      // "1.299" (3 digits after dot) or "1.299.000" → dots are thousands
      const num = parseFloat(cleaned.replace(/\./g, ""));
      return isNaN(num) ? null : num;
    }
  } else {
    // No comma, no dot: "472" → plain integer
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
}

function pickValidPrice(...prices: Array<number | null | undefined>): number | null {
  for (const price of prices) {
    if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

function pickString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

// Görsel URL'yi temizle — bazen JSON object geliyor, string olmalı
function cleanImageUrl(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (typeof img === "object" && img !== null) {
    const imgObj = img as Record<string, unknown>;
    // JSON-LD bazen {"@type": "ImageObject", "contentUrl": "..."} döndürür
    if (imgObj.contentUrl) {
      return Array.isArray(imgObj.contentUrl)
        ? (imgObj.contentUrl[0] as string)
        : (imgObj.contentUrl as string);
    }
    if (imgObj.url) return imgObj.url as string;
    if (Array.isArray(img) && img.length > 0) {
      if (typeof img[0] === "string") return img[0];
      const first = img[0] as Record<string, unknown> | null;
      return (first?.url as string) || (first?.contentUrl as string) || null;
    }
  }
  return null;
}

// JSON-LD'den ürün bilgisi çek
function extractFromJsonLd($: cheerio.CheerioAPI): {
  name: string;
  price: number | null;
  image: string | null;
  seller: string | null;
} {
  let name = "";
  let price: number | null = null;
  let image: string | null = null;
  let seller: string | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "");
      const product =
        json?.["@type"] === "Product"
          ? json
          : Array.isArray(json?.["@graph"])
            ? json["@graph"].find((item: Record<string, unknown>) => item?.["@type"] === "Product")
            : null;
      if (product) {
        if (!name) name = product.name || "";
        if (!image) image = cleanImageUrl(product.image);
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (!price && offers?.price) {
          const parsed = parsePrice(String(offers.price));
          if (parsed && parsed > 0) price = parsed;
        }
        if (!seller && offers?.seller?.name) seller = offers.seller.name;
      }
    } catch {
      // Invalid JSON-LD block — skip silently (common on marketplace pages)
    }
  });

  return { name, price, image, seller };
}

export async function scrapeMediaMarkt(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const jsonLd = extractFromJsonLd($);
    const meta = extractFromMeta($);

    const metaPrice = parsePrice(
      $("meta[property='product:price:amount']").attr("content") ||
        $("meta[property='og:price:amount']").attr("content") ||
        $("meta[itemprop='price']").attr("content") ||
        "",
    );

    const selectorName = pickString(
      $("h1[data-test='product-title']").first().text(),
      $("h1[data-test='mms-product-name']").first().text(),
      $("h1[data-test-id='pdp-product-name']").first().text(),
      $("h1").first().text(),
    );

    const selectorPrice = pickValidPrice(
      parsePrice($("[data-test='branded-price-whole-value']").first().text()),
      parsePrice($("[data-test='product-price']").first().text()),
      parsePrice($("[data-test='mms-price']").first().text()),
      parsePrice($("[itemprop='price']").first().attr("content") || ""),
      parsePrice($(".price").first().text()),
    );

    const selectorImage = pickString(
      $("img[data-test='product-image']").first().attr("src"),
      $("img[data-test='product-image']").first().attr("data-src"),
      $("img[itemprop='image']").first().attr("src"),
      $("meta[property='og:image']").attr("content"),
    );

    const selectorSeller = pickString(
      $("[data-test='marketplace-seller-name']").first().text(),
      $("[data-test='sold-and-shipped-by']").first().text(),
      $("[itemprop='seller']").first().text(),
    );

    return {
      name:
        pickString(jsonLd.name, selectorName, meta.name, "MediaMarkt ürünü") || "MediaMarkt ürünü",
      price: pickValidPrice(jsonLd.price, selectorPrice, metaPrice),
      currency: "TRY",
      image: pickString(jsonLd.image, selectorImage, meta.image),
      seller: pickString(jsonLd.seller, selectorSeller),
      inStock:
        !html.toLowerCase().includes("out-of-stock") &&
        !html.toLowerCase().includes("stokta yok") &&
        !html.toLowerCase().includes("ürün tükendi"),
    };
  } catch (e) {
    console.error("MediaMarkt scrape error:", e);
    return {
      name: "MediaMarkt ürünü",
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// Meta tag'lardan bilgi çek
function extractFromMeta($: cheerio.CheerioAPI): { name: string; image: string | null } {
  const name =
    $("meta[property='og:title']").attr("content") || $("meta[name='title']").attr("content") || "";
  const image = $("meta[property='og:image']").attr("content") || null;
  return { name, image };
}

// Trendyol başlığını temizle — "- Online Alışveriş" ve benzeri ekleri kaldır
function cleanTrendyolTitle(title: string): string {
  return title
    .replace(/\s*[-–]\s*Online Alışveriş.*$/i, "")
    .replace(/\s*[-–]\s*Trendyol\.com.*$/i, "")
    .replace(/\s*\|\s*Trendyol.*$/i, "")
    .trim();
}

// __PRODUCT_DETAIL_APP_INITIAL_STATE__ script'inden ürün bilgisi çek
function extractFromTrendyolInitialState($: cheerio.CheerioAPI): {
  name: string;
  price: number | null;
  image: string | null;
  seller: string | null;
} {
  let name = "";
  let price: number | null = null;
  let image: string | null = null;
  let seller: string | null = null;

  $("script").each((_, el) => {
    const content = $(el).html() || "";
    if (content.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__")) {
      try {
        const match = content.match(/__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (match) {
          const state = JSON.parse(match[1]);
          const product = state.product;
          if (product) {
            if (!name && product.name) name = product.name;
            if (!price && product.price?.sellingPrice?.value)
              price = product.price.sellingPrice.value;
            if (!price && product.price?.discountedPrice?.value)
              price = product.price.discountedPrice.value;
            if (!price && product.price?.originalPrice?.value)
              price = product.price.originalPrice.value;
            if (!seller && product.merchant?.name) seller = product.merchant.name;
            if (!image && product.images?.length > 0) image = product.images[0];
            if (!image && product.mediaFiles?.length > 0) image = product.mediaFiles[0]?.url;
          }
        }
      } catch {
        // Malformed initial state JSON — skip silently
      }
    }
  });

  return { name, price, image, seller };
}

// TRENDYOL
export async function scrapeTrendyol(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. JSON-LD
    const jsonLd = extractFromJsonLd($);

    // 2. __PRODUCT_DETAIL_APP_INITIAL_STATE__ (Trendyol SSR hydration verisi)
    const initialState = extractFromTrendyolInitialState($);

    // 3. Meta tags
    const meta = extractFromMeta($);
    const metaPriceStr = $("meta[property='product:price:amount']").attr("content");
    const metaPrice = metaPriceStr ? parseFloat(metaPriceStr) : null;
    const metaImage = $("meta[property='og:image']").attr("content") || null;

    // 4. HTML fallback
    const htmlName =
      $(".pr-new-br h1").text().trim() ||
      $("h1.pr-new-br span").first().text().trim() ||
      $("h1").first().text().trim();
    const htmlPrice = parsePrice(
      $("span.prc-dsc").first().text().trim() || $("span.prc-slg").first().text().trim(),
    );
    const htmlImage =
      $(".base-product-image img").attr("src") || $("img.detail-section-img").attr("src") || null;
    const htmlSeller = $(".merchant-text").text().trim() || $(".seller-name").text().trim() || null;

    // İsmi temizle — "- Online Alışveriş" gibi ekleri kaldır
    const rawName =
      jsonLd.name ||
      initialState.name ||
      htmlName ||
      cleanTrendyolTitle(meta.name) ||
      "Trendyol ürünü";
    const cleanName = cleanTrendyolTitle(rawName);

    return {
      name: cleanName || "Trendyol ürünü",
      price: jsonLd.price || initialState.price || htmlPrice || metaPrice,
      currency: "TRY",
      image: jsonLd.image || initialState.image || htmlImage || metaImage || meta.image,
      seller: jsonLd.seller || initialState.seller || htmlSeller,
      inStock: !html.includes("pr-out-of-stock") && !html.includes("out-of-stock-btn"),
    };
  } catch (e) {
    console.error("Trendyol scrape error:", e);
    return {
      name: "Trendyol ürünü",
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// HEPSIBURADA — og: meta tagları kullan (JS gerektirmez)
export async function scrapeHepsiburada(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. JSON-LD
    const jsonLd = extractFromJsonLd($);

    // 2. Meta tags — Hepsiburada meta tag'larını iyi doldurur
    const ogTitle = $("meta[property='og:title']").attr("content") || "";
    const ogImage = $("meta[property='og:image']").attr("content") || null;
    const ogPrice = $("meta[property='product:price:amount']").attr("content");
    const metaPrice = ogPrice ? parseFloat(ogPrice) : null;

    // 3. Sayfadaki description'dan fiyat çekmeye çalış
    const descContent = $("meta[name='description']").attr("content") || "";
    let descPrice: number | null = null;
    const priceMatch = descContent.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*TL/);
    if (priceMatch) {
      descPrice = parsePrice(priceMatch[1]);
    }

    // Title temizle — " - Hepsiburada" kısmını kaldır
    let cleanTitle = (jsonLd.name || ogTitle)
      .replace(/\s*[-–]\s*Hepsiburada.*$/i, "")
      .replace(/\s*[-–]\s*Online Alışveriş.*$/i, "")
      .trim();
    if (!cleanTitle || cleanTitle === "Hepsiburada")
      cleanTitle = $("title")
        .text()
        .replace(/\s*[-–]\s*Hepsiburada.*$/i, "")
        .trim();

    return {
      name: cleanTitle || "Hepsiburada ürünü",
      price: jsonLd.price || metaPrice || descPrice,
      currency: "TRY",
      image: jsonLd.image || ogImage,
      seller: jsonLd.seller,
      inStock: !html.includes("tükendi") && !html.includes("out-of-stock"),
    };
  } catch (e) {
    console.error("Hepsiburada scrape error:", e);
    return {
      name: "Hepsiburada ürünü",
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// AMAZON TR
export async function scrapeAmazonTR(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const jsonLd = extractFromJsonLd($);
    const meta = extractFromMeta($);
    const htmlName = $("#productTitle").text().trim();
    const htmlPrice = parsePrice($(".a-price .a-offscreen").first().text().trim());
    const htmlImage = $("#landingImage").attr("src") || null;

    return {
      name: jsonLd.name || htmlName || meta.name || "Amazon ürünü",
      price: jsonLd.price || htmlPrice,
      currency: "TRY",
      image: jsonLd.image || htmlImage || meta.image,
      seller: $("#sellerProfileTriggerId").text().trim() || null,
      inStock: !$("#outOfStock").length,
    };
  } catch {
    return {
      name: "Amazon ürünü",
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// N11
export async function scrapeN11(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const jsonLd = extractFromJsonLd($);
    const meta = extractFromMeta($);
    const htmlName = $("h1.proName").text().trim();
    const htmlPrice = parsePrice($(".newPrice ins").text().trim());

    return {
      name: jsonLd.name || htmlName || meta.name || "N11 ürünü",
      price: jsonLd.price || htmlPrice,
      currency: "TRY",
      image: jsonLd.image || meta.image,
      seller: null,
      inStock: true,
    };
  } catch {
    return {
      name: "N11 ürünü",
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// Genel scraper (diğer tüm siteler için)
export async function scrapeGeneric(url: string, label: string): Promise<ScrapedProduct> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const jsonLd = extractFromJsonLd($);
    const meta = extractFromMeta($);

    return {
      name: jsonLd.name || meta.name || `${label} ürünü`,
      price: jsonLd.price,
      currency: "TRY",
      image: jsonLd.image || meta.image,
      seller: jsonLd.seller,
      inStock: true,
    };
  } catch {
    return {
      name: `${label} ürünü`,
      price: null,
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  }
}

// ANA FONKSİYON
export async function scrapeProduct(url: string, marketplace: string): Promise<ScrapedProduct> {
  switch (marketplace) {
    case "TRENDYOL":
      return scrapeTrendyol(url);
    case "HEPSIBURADA":
      return scrapeHepsiburada(url);
    case "AMAZON_TR":
      return scrapeAmazonTR(url);
    case "N11":
      return scrapeN11(url);
    case "MEDIAMARKT":
      return scrapeMediaMarkt(url);
    default:
      return scrapeGeneric(url, marketplace);
  }
}
