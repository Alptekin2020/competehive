import * as cheerio from "cheerio";
import { logger } from "../utils/logger";
import {
  SUPPORTED_SCRAPER_MARKETPLACES,
  type SupportedScraperMarketplace,
} from "../shared";

// ============================================
// Scraper Types
// ============================================

export interface ScrapedProduct {
  name: string;
  price: number;
  currency: string;
  inStock: boolean;
  sellerName?: string;
  imageUrl?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ScraperConfig {
  proxyUrl?: string;
  userAgent?: string;
  timeout?: number;
}

export class ScraperError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly softFail: boolean;

  constructor(message: string, options: { code: string; retryable?: boolean; softFail?: boolean }) {
    super(message);
    this.name = "ScraperError";
    this.code = options.code;
    this.retryable = options.retryable ?? true;
    this.softFail = options.softFail ?? false;
  }
}

export function createUnsupportedMarketplaceError(marketplace: string): ScraperError {
  return new ScraperError(`Desteklenmeyen marketplace: ${marketplace}`, {
    code: "UNSUPPORTED_MARKETPLACE",
    retryable: false,
    softFail: true,
  });
}

function parsePrice(raw?: string | null): number {
  if (!raw) return 0;
  const normalized = raw
    .replace(/\u00a0/g, " ")
    .replace(/[^\d.,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

// ============================================
// User Agent Rotasyonu
// ============================================

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ============================================
// HTTP Fetch with retry
// ============================================

async function fetchWithRetry(url: string, config: ScraperConfig, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout || 15000);

      const headers: Record<string, string> = {
        "User-Agent": config.userAgent || getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      };

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      logger.warn({ error }, `Fetch attempt ${attempt}/${retries} failed for ${url}`);
      if (attempt === retries) throw error;

      // Exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error("All fetch attempts failed");
}

// ============================================
// TRENDYOL SCRAPER
// ============================================

export async function scrapeTrendyol(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping Trendyol: ${url}`);

  const html = await fetchWithRetry(url, config);
  const $ = cheerio.load(html);

  // Trendyol ürün verisi genelde __PRODUCT_DETAIL_APP_INITIAL_STATE__ içinde JSON olarak bulunur
  let productData: ScrapedProduct | null = null;

  // Method 1: JSON-LD structured data
  const jsonLd = $('script[type="application/ld+json"]').first().html();
  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd);
      if (ld["@type"] === "Product") {
        productData = {
          name: ld.name || "",
          price: parseFloat(ld.offers?.price || ld.offers?.[0]?.price || "0"),
          currency: ld.offers?.priceCurrency || "TRY",
          inStock: ld.offers?.availability?.includes("InStock") ?? true,
          imageUrl: ld.image?.[0] || ld.image || undefined,
          rating: ld.aggregateRating?.ratingValue
            ? parseFloat(ld.aggregateRating.ratingValue)
            : undefined,
          reviewCount: ld.aggregateRating?.reviewCount
            ? parseInt(ld.aggregateRating.reviewCount)
            : undefined,
          sellerName: ld.offers?.seller?.name || undefined,
          category: ld.category || undefined,
        };
      }
    } catch (e) {
      logger.warn("JSON-LD parse failed, falling back to HTML parsing");
    }
  }

  // Method 2: HTML parsing fallback
  if (!productData || productData.price === 0) {
    const name = $(".pr-new-br h1").text().trim() || $("h1.product-name").text().trim();
    const priceText =
      $(".prc-dsc").first().text().trim() || $(".product-price-container .prc-slg").text().trim();
    const price = parseFloat(priceText.replace(/[^\d,]/g, "").replace(",", ".")) || 0;
    const sellerName = $(".merchant-text").text().trim() || $(".seller-name").text().trim();
    const imageUrl =
      $(".base-product-image img").attr("src") || $("img.detail-section-img").attr("src");
    const inStock = !$(".out-of-stock-btn").length;

    productData = {
      name: productData?.name || name,
      price: price || productData?.price || 0,
      currency: "TRY",
      inStock,
      sellerName: sellerName || productData?.sellerName,
      imageUrl: imageUrl || productData?.imageUrl,
      rating: productData?.rating,
      reviewCount: productData?.reviewCount,
    };
  }

  // Method 3: Script tag'lerden veri çekme
  if (!productData.name || productData.price === 0) {
    $("script").each((_, el) => {
      const content = $(el).html() || "";
      if (content.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__")) {
        try {
          const match = content.match(/__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const state = JSON.parse(match[1]);
            const product = state.product;
            if (product) {
              productData!.name = productData!.name || product.name;
              productData!.price = productData!.price || product.price?.sellingPrice?.value;
              productData!.sellerName = productData!.sellerName || product.merchant?.name;
              productData!.category = productData!.category || product.category?.name;
            }
          }
        } catch (e) {
          logger.warn("Script state parse failed");
        }
      }
    });
  }

  if (!productData.name && productData.price === 0) {
    throw new Error("Trendyol ürün bilgileri çekilemedi. Sayfa yapısı değişmiş olabilir.");
  }

  logger.info(
    `Trendyol scraped: ${productData.name} - ${productData.price} ${productData.currency}`,
  );
  return productData;
}

// ============================================
// HEPSIBURADA SCRAPER
// ============================================

export async function scrapeHepsiburada(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping Hepsiburada: ${url}`);

  const html = await fetchWithRetry(url, config);
  const $ = cheerio.load(html);

  let productData: ScrapedProduct | null = null;

  // JSON-LD
  const jsonLd = $('script[type="application/ld+json"]').first().html();
  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd);
      if (ld["@type"] === "Product") {
        productData = {
          name: ld.name || "",
          price: parseFloat(ld.offers?.price || ld.offers?.[0]?.price || "0"),
          currency: ld.offers?.priceCurrency || "TRY",
          inStock: ld.offers?.availability?.includes("InStock") ?? true,
          imageUrl: ld.image?.[0] || ld.image || undefined,
          sellerName: ld.offers?.seller?.name || undefined,
          rating: ld.aggregateRating?.ratingValue
            ? parseFloat(ld.aggregateRating.ratingValue)
            : undefined,
          reviewCount: ld.aggregateRating?.reviewCount
            ? parseInt(ld.aggregateRating.reviewCount)
            : undefined,
        };
      }
    } catch (e) {
      logger.warn("JSON-LD parse failed for Hepsiburada");
    }
  }

  // HTML fallback
  if (!productData || productData.price === 0) {
    const name = $("h1#product-name").text().trim() || $("h1.product-name").text().trim();
    const priceText =
      $("[data-test-id='price-current-price']").text().trim() || $(".product-price").text().trim();
    const price = parseFloat(priceText.replace(/[^\d,]/g, "").replace(",", ".")) || 0;

    productData = {
      name: productData?.name || name,
      price: price || productData?.price || 0,
      currency: "TRY",
      inStock: !$(".out-of-stock").length,
      sellerName: productData?.sellerName || $(".merchant-name").text().trim(),
      imageUrl: productData?.imageUrl || $("img.product-image").attr("src"),
    };
  }

  if (!productData.name && productData.price === 0) {
    throw new Error("Hepsiburada ürün bilgileri çekilemedi.");
  }

  logger.info(
    `Hepsiburada scraped: ${productData.name} - ${productData.price} ${productData.currency}`,
  );
  return productData;
}

// ============================================
// AMAZON TR SCRAPER
// ============================================

export async function scrapeAmazonTR(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping Amazon TR: ${url}`);

  const html = await fetchWithRetry(url, config);
  const $ = cheerio.load(html);

  const jsonLd = $('script[type="application/ld+json"]').first().html();
  let parsedFromLd: Partial<ScrapedProduct> = {};

  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd);
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      parsedFromLd = {
        name: ld?.name,
        price: parseFloat(offer?.price || "0"),
        currency: offer?.priceCurrency || "TRY",
        sellerName: offer?.seller?.name,
        imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image,
        inStock: offer?.availability?.includes("InStock") ?? true,
      };
    } catch {
      logger.warn("Amazon TR JSON-LD parse failed");
    }
  }

  const htmlName = $("#productTitle").text().trim();
  const htmlPrice = parsePrice($(".a-price .a-offscreen").first().text().trim());
  const sellerName = $("#sellerProfileTriggerId").text().trim() || $("#merchantInfo").text().trim();
  const imageUrl = $("#landingImage").attr("src") || $("#imgTagWrapperId img").attr("src");
  const inStock = !$("#outOfStock").length && !html.toLowerCase().includes("currently unavailable");

  const result: ScrapedProduct = {
    name: parsedFromLd.name || htmlName,
    price: parsedFromLd.price || htmlPrice,
    currency: parsedFromLd.currency || "TRY",
    inStock: parsedFromLd.inStock ?? inStock,
    sellerName: parsedFromLd.sellerName || sellerName || undefined,
    imageUrl: parsedFromLd.imageUrl || imageUrl || undefined,
  };

  if (!result.name || result.price === 0) {
    throw new ScraperError("Amazon TR ürün bilgileri çekilemedi.", {
      code: "SCRAPE_PARSE_FAILED",
      retryable: true,
    });
  }

  logger.info(`Amazon TR scraped: ${result.name} - ${result.price} ${result.currency}`);
  return result;
}

// ============================================
// N11 SCRAPER
// ============================================

export async function scrapeN11(url: string, config: ScraperConfig = {}): Promise<ScrapedProduct> {
  logger.info(`Scraping N11: ${url}`);

  const html = await fetchWithRetry(url, config);
  const $ = cheerio.load(html);

  const jsonLd = $('script[type="application/ld+json"]').first().html();
  let parsedFromLd: Partial<ScrapedProduct> = {};

  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd);
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      parsedFromLd = {
        name: ld?.name,
        price: parseFloat(offer?.price || "0"),
        currency: offer?.priceCurrency || "TRY",
        sellerName: offer?.seller?.name,
        imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image,
        inStock: offer?.availability?.includes("InStock") ?? true,
      };
    } catch {
      logger.warn("N11 JSON-LD parse failed");
    }
  }

  const htmlName = $("h1.proName").text().trim() || $("h1").first().text().trim();
  const htmlPrice = parsePrice(
    $(".newPrice ins").first().text().trim() || $(".priceContainer ins").first().text().trim(),
  );
  const imageUrl =
    $(".imgObj").attr("data-original") || $("meta[property='og:image']").attr("content");
  const sellerName = $(".unf-p-sellerInfo a").text().trim() || undefined;
  const inStock = !html.toLowerCase().includes("stokta yok");

  const result: ScrapedProduct = {
    name: parsedFromLd.name || htmlName,
    price: parsedFromLd.price || htmlPrice,
    currency: parsedFromLd.currency || "TRY",
    inStock: parsedFromLd.inStock ?? inStock,
    sellerName: parsedFromLd.sellerName || sellerName,
    imageUrl: parsedFromLd.imageUrl || imageUrl || undefined,
  };

  if (!result.name || result.price === 0) {
    throw new ScraperError("N11 ürün bilgileri çekilemedi.", {
      code: "SCRAPE_PARSE_FAILED",
      retryable: true,
    });
  }

  logger.info(`N11 scraped: ${result.name} - ${result.price} ${result.currency}`);
  return result;
}

// ============================================
// SCRAPER FACTORY
// ============================================

export function getScraper(marketplace: string) {
  switch (marketplace) {
    case "TRENDYOL":
      return scrapeTrendyol;
    case "HEPSIBURADA":
      return scrapeHepsiburada;
    case "AMAZON_TR":
      return scrapeAmazonTR;
    case "N11":
      return scrapeN11;
    default:
      if (!SUPPORTED_SCRAPER_MARKETPLACES.includes(marketplace as SupportedScraperMarketplace)) {
        return async () => {
          throw createUnsupportedMarketplaceError(marketplace);
        };
      }

      return async () => {
        throw new ScraperError(`Marketplace scraper tanımlı değil: ${marketplace}`, {
          code: "SCRAPER_NOT_IMPLEMENTED",
          retryable: false,
          softFail: true,
        });
      };
  }
}
