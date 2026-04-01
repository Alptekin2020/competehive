import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { logger } from "../utils/logger";
import { getCachedScrapeResult, setCachedScrapeResult } from "../utils/cache";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
      logger.warn(`Fetch attempt ${attempt}/${retries} failed for ${url}: ${errorMessage(error)}`);
      if (attempt === retries) throw error;

      // Exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error("All fetch attempts failed");
}

// ============================================
// JSON Fetch with retry (for API endpoints)
// ============================================

async function fetchJsonWithRetry(
  url: string,
  config: ScraperConfig,
  retries = 2,
): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout || 15000);

      const headers: Record<string, string> = {
        "User-Agent": config.userAgent || getRandomUserAgent(),
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.trendyol.com/",
        Origin: "https://www.trendyol.com",
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

      return await response.json();
    } catch (error) {
      logger.warn(
        `JSON fetch attempt ${attempt}/${retries} failed for ${url}: ${errorMessage(error)}`,
      );
      if (attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error("All JSON fetch attempts failed");
}

// ============================================
// Puppeteer-based scraping fallback
// ============================================

let browserInstance: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--single-process",
    ],
  });

  return browserInstance;
}

async function scrapeWithPuppeteer(url: string, config: ScraperConfig): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(config.userAgent || getRandomUserAgent());
    await page.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeout || 30000,
    });

    // Wait a bit for JS to render product data
    await new Promise((r) => setTimeout(r, 3000));

    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

// ============================================
// Extract Trendyol content ID from URL
// ============================================

function extractTrendyolContentId(url: string): string | null {
  // Trendyol URLs have pattern: ...p-{contentId}...
  const match = url.match(/p-(\d+)/);
  return match ? match[1] : null;
}

// ============================================
// Parse HTML for Trendyol product data
// ============================================

function parseTrendyolHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  // Use a mutable holder to avoid TS narrowing issues inside callbacks
  const holder: { data: ScrapedProduct | null } = { data: null };

  // Method 1: JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      if (ld["@type"] === "Product") {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        holder.data = {
          name: ld.name || "",
          price: parseFloat(offer?.price || "0"),
          currency: offer?.priceCurrency || "TRY",
          inStock: offer?.availability?.includes("InStock") ?? true,
          imageUrl: ld.image?.[0] || ld.image || undefined,
          rating: ld.aggregateRating?.ratingValue
            ? parseFloat(ld.aggregateRating.ratingValue)
            : undefined,
          reviewCount: ld.aggregateRating?.reviewCount
            ? parseInt(ld.aggregateRating.reviewCount)
            : undefined,
          sellerName: offer?.seller?.name || undefined,
          category: ld.category || undefined,
        };
      }
    } catch {
      // continue to next script tag
    }
  });

  let productData = holder.data;

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

  // Method 3: Script tag state extraction
  if (!productData.name || productData.price === 0) {
    const pd = productData;
    $("script").each((_, el) => {
      const content = $(el).html() || "";
      if (content.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__")) {
        try {
          const match = content.match(/__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const state = JSON.parse(match[1]);
            const product = state.product;
            if (product) {
              pd.name = pd.name || product.name;
              pd.price = pd.price || product.price?.sellingPrice?.value;
              pd.sellerName = pd.sellerName || product.merchant?.name;
              pd.category = pd.category || product.category?.name;
            }
          }
        } catch {
          // continue
        }
      }
    });
    productData = pd;
  }

  if (productData && (productData.name || productData.price > 0)) {
    return productData;
  }

  return null;
}

// ============================================
// TRENDYOL SCRAPER
// ============================================

export async function scrapeTrendyol(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  const cached = await getCachedScrapeResult<ScrapedProduct>(url);
  if (cached) return cached;

  logger.info(`Scraping Trendyol: ${url}`);

  // Strategy 1: Use Trendyol public API (most reliable from cloud IPs)
  const contentId = extractTrendyolContentId(url);
  if (contentId) {
    try {
      const apiUrl = `https://public.trendyol.com/discovery-web-productgw-service/api/productDetail/${contentId}`;
      logger.info(`Trying Trendyol API: contentId=${contentId}`);
      const data = (await fetchJsonWithRetry(apiUrl, config)) as Record<string, unknown>;

      const result = data?.result as Record<string, unknown> | undefined;
      if (result) {
        const price = result.price as Record<string, unknown> | undefined;
        const sellingPrice = price?.sellingPrice as Record<string, unknown> | undefined;
        const discountedPrice = price?.discountedPrice as Record<string, unknown> | undefined;
        const originalPrice = price?.originalPrice as Record<string, unknown> | undefined;
        const priceValue =
          (discountedPrice?.value as number) ||
          (sellingPrice?.value as number) ||
          (originalPrice?.value as number) ||
          0;

        const images = result.images as string[] | undefined;
        const category = result.category as Record<string, unknown> | undefined;
        const ratingScore = result.ratingScore as Record<string, unknown> | undefined;
        const merchant = result.merchant as Record<string, unknown> | undefined;

        if (priceValue > 0) {
          const product: ScrapedProduct = {
            name: (result.name as string) || (result.productName as string) || "",
            price: priceValue,
            currency: "TRY",
            inStock: (result.inStock as boolean) ?? true,
            imageUrl: images?.[0] ? `https://cdn.dsmcdn.com/${images[0]}` : undefined,
            category: (category?.name as string) || undefined,
            sellerName: (merchant?.name as string) || undefined,
            rating: ratingScore?.averageRating
              ? parseFloat(String(ratingScore.averageRating))
              : undefined,
            reviewCount: ratingScore?.totalRatingCount
              ? parseInt(String(ratingScore.totalRatingCount))
              : undefined,
          };

          logger.info(
            `Trendyol API success: ${product.name} - ${product.price} ${product.currency}`,
          );
          await setCachedScrapeResult(url, product);
          return product;
        }
      }

      logger.warn("Trendyol API returned data but no valid price, trying other methods");
    } catch (error) {
      logger.warn(`Trendyol API failed: ${errorMessage(error)}, trying fetch+HTML`);
    }
  }

  // Strategy 2: Direct HTML fetch
  try {
    const html = await fetchWithRetry(url, config);
    const product = parseTrendyolHtml(html);
    if (product && product.price > 0) {
      logger.info(`Trendyol HTML scraped: ${product.name} - ${product.price} ${product.currency}`);
      await setCachedScrapeResult(url, product);
      return product;
    }
    logger.warn("Trendyol HTML fetch returned no product data, trying Puppeteer");
  } catch (error) {
    logger.warn(`Trendyol HTML fetch failed: ${errorMessage(error)}, trying Puppeteer`);
  }

  // Strategy 3: Puppeteer (handles JS-rendered pages and bot protection)
  try {
    logger.info("Attempting Trendyol scrape with Puppeteer");
    const html = await scrapeWithPuppeteer(url, config);
    const product = parseTrendyolHtml(html);
    if (product && product.price > 0) {
      logger.info(
        `Trendyol Puppeteer scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      await setCachedScrapeResult(url, product);
      return product;
    }
  } catch (error) {
    logger.warn(`Trendyol Puppeteer scrape failed: ${errorMessage(error)}`);
  }

  throw new ScraperError(
    "Trendyol urun bilgileri tum yontemlerle cekilemedi (API + HTML + Puppeteer)",
    {
      code: "SCRAPE_ALL_METHODS_FAILED",
      retryable: true,
    },
  );
}

// Helper: wrap scrapeWithFallback results with caching
async function scrapeWithFallbackCached(
  url: string,
  config: ScraperConfig,
  parseHtml: (html: string) => ScrapedProduct | null,
  marketplaceName: string,
): Promise<ScrapedProduct> {
  const cached = await getCachedScrapeResult<ScrapedProduct>(url);
  if (cached) return cached;

  const result = await scrapeWithFallback(url, config, parseHtml, marketplaceName);
  await setCachedScrapeResult(url, result);
  return result;
}

// ============================================
// Generic HTML parse helper for other marketplaces
// ============================================

async function scrapeWithFallback(
  url: string,
  config: ScraperConfig,
  parseHtml: (html: string) => ScrapedProduct | null,
  marketplaceName: string,
): Promise<ScrapedProduct> {
  // Strategy 1: Direct HTML fetch
  try {
    const html = await fetchWithRetry(url, config);
    const product = parseHtml(html);
    if (product && product.price > 0) {
      logger.info(
        `${marketplaceName} HTML scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      return product;
    }
    logger.warn(`${marketplaceName} HTML fetch returned no product data, trying Puppeteer`);
  } catch (error) {
    logger.warn(`${marketplaceName} HTML fetch failed: ${errorMessage(error)}, trying Puppeteer`);
  }

  // Strategy 2: Puppeteer fallback
  try {
    logger.info(`Attempting ${marketplaceName} scrape with Puppeteer`);
    const html = await scrapeWithPuppeteer(url, config);
    const product = parseHtml(html);
    if (product && product.price > 0) {
      logger.info(
        `${marketplaceName} Puppeteer scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      return product;
    }
  } catch (error) {
    logger.warn(`${marketplaceName} Puppeteer scrape failed: ${errorMessage(error)}`);
  }

  throw new ScraperError(`${marketplaceName} urun bilgileri cekilemedi (HTML + Puppeteer)`, {
    code: "SCRAPE_ALL_METHODS_FAILED",
    retryable: true,
  });
}

// ============================================
// HEPSIBURADA SCRAPER
// ============================================

function parseHepsiburadaHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const holder: { data: ScrapedProduct | null } = { data: null };

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      if (ld["@type"] === "Product") {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        holder.data = {
          name: ld.name || "",
          price: parseFloat(offer?.price || "0"),
          currency: offer?.priceCurrency || "TRY",
          inStock: offer?.availability?.includes("InStock") ?? true,
          imageUrl: ld.image?.[0] || ld.image || undefined,
          sellerName: offer?.seller?.name || undefined,
          rating: ld.aggregateRating?.ratingValue
            ? parseFloat(ld.aggregateRating.ratingValue)
            : undefined,
          reviewCount: ld.aggregateRating?.reviewCount
            ? parseInt(ld.aggregateRating.reviewCount)
            : undefined,
        };
      }
    } catch {
      // continue
    }
  });

  let productData = holder.data;

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

  if (productData && (productData.name || productData.price > 0)) {
    return productData;
  }
  return null;
}

export async function scrapeHepsiburada(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping Hepsiburada: ${url}`);
  return scrapeWithFallbackCached(url, config, parseHepsiburadaHtml, "Hepsiburada");
}

// ============================================
// AMAZON TR SCRAPER
// ============================================

function parseAmazonTRHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const holder: { data: Partial<ScrapedProduct> } = { data: {} };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data.price && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      if (offer?.price) {
        holder.data = {
          name: ld?.name,
          price: parseFloat(offer.price || "0"),
          currency: offer.priceCurrency || "TRY",
          sellerName: offer.seller?.name,
          imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image,
          inStock: offer.availability?.includes("InStock") ?? true,
        };
      }
    } catch {
      // continue
    }
  });

  const parsedFromLd = holder.data;
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

  if (result.name || result.price > 0) {
    return result;
  }
  return null;
}

export async function scrapeAmazonTR(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping Amazon TR: ${url}`);
  return scrapeWithFallbackCached(url, config, parseAmazonTRHtml, "Amazon TR");
}

// ============================================
// N11 SCRAPER
// ============================================

function parseN11Html(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const holder: { data: Partial<ScrapedProduct> } = { data: {} };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data.price && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      if (offer?.price) {
        holder.data = {
          name: ld?.name,
          price: parseFloat(offer.price || "0"),
          currency: offer.priceCurrency || "TRY",
          sellerName: offer.seller?.name,
          imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image,
          inStock: offer.availability?.includes("InStock") ?? true,
        };
      }
    } catch {
      // continue
    }
  });

  const parsedFromLd = holder.data;
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

  if (result.name || result.price > 0) {
    return result;
  }
  return null;
}

export async function scrapeN11(url: string, config: ScraperConfig = {}): Promise<ScrapedProduct> {
  logger.info(`Scraping N11: ${url}`);
  return scrapeWithFallbackCached(url, config, parseN11Html, "N11");
}

// ============================================
// MEDIAMARKT SCRAPER
// ============================================

function parseMediaMarktHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const holder: { data: Partial<ScrapedProduct> } = { data: {} };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data.price && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      const product =
        ld?.["@type"] === "Product"
          ? ld
          : Array.isArray(ld?.["@graph"])
            ? ld["@graph"].find((item: Record<string, unknown>) => item?.["@type"] === "Product")
            : null;
      if (product) {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        const price = parsePrice(String(offer?.price || ""));
        holder.data = {
          name: product.name || undefined,
          price,
          currency: offer?.priceCurrency || "TRY",
          inStock: offer?.availability?.includes("InStock") ?? true,
          imageUrl: Array.isArray(product.image) ? product.image[0] : product.image || undefined,
          sellerName: offer?.seller?.name || undefined,
        };
      }
    } catch {
      // continue
    }
  });

  const parsedFromLd = holder.data;

  const htmlName =
    $('h1[data-test="product-title"]').first().text().trim() ||
    $('h1[data-test="mms-product-name"]').first().text().trim() ||
    $("h1").first().text().trim();

  const htmlPrice = parsePrice(
    $('[data-test="branded-price-whole-value"]').first().text().trim() ||
      $('[data-test="product-price"]').first().text().trim() ||
      $('[itemprop="price"]').attr("content") ||
      $(".price").first().text().trim(),
  );

  const imageUrl =
    $('img[data-test="product-image"]').first().attr("src") ||
    $('img[data-test="product-image"]').first().attr("data-src") ||
    $('meta[property="og:image"]').attr("content");

  const sellerName =
    $('[data-test="marketplace-seller-name"]').first().text().trim() ||
    $('[data-test="sold-and-shipped-by"]').first().text().trim() ||
    undefined;

  const htmlLower = html.toLowerCase();
  const inStock =
    !htmlLower.includes("out-of-stock") &&
    !htmlLower.includes("stokta yok") &&
    !htmlLower.includes("ürün tükendi");

  const result: ScrapedProduct = {
    name: parsedFromLd.name || htmlName,
    price: parsedFromLd.price || htmlPrice,
    currency: parsedFromLd.currency || "TRY",
    inStock: parsedFromLd.inStock ?? inStock,
    sellerName: parsedFromLd.sellerName || sellerName,
    imageUrl: parsedFromLd.imageUrl || imageUrl || undefined,
  };

  if (result.name || result.price > 0) {
    return result;
  }

  return null;
}

export async function scrapeMediaMarkt(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping MediaMarkt: ${url}`);
  return scrapeWithFallbackCached(url, config, parseMediaMarktHtml, "MediaMarkt");
}

// ============================================
// GENERIC SCRAPER (JSON-LD + Meta Tags)
// ============================================

export async function scrapeGeneric(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping (generic): ${url}`);

  const parseGenericHtml = (html: string): ScrapedProduct | null => {
    const $ = cheerio.load(html);

    const holder: { data: ScrapedProduct | null } = { data: null };

    // Try JSON-LD first
    $('script[type="application/ld+json"]').each((_, el) => {
      if (holder.data && holder.data.price > 0) return;
      try {
        const raw = $(el).html();
        if (!raw) return;
        const ld = JSON.parse(raw);

        // Handle both direct Product and @graph arrays
        const product =
          ld["@type"] === "Product"
            ? ld
            : Array.isArray(ld["@graph"])
              ? ld["@graph"].find((item: Record<string, unknown>) => item["@type"] === "Product")
              : null;

        if (product) {
          const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
          holder.data = {
            name: product.name || "",
            price: parseFloat(offers?.price || "0"),
            currency: offers?.priceCurrency || "TRY",
            inStock: offers?.availability?.includes("InStock") ?? true,
            imageUrl: Array.isArray(product.image) ? product.image[0] : product.image || undefined,
            sellerName: offers?.seller?.name || undefined,
            rating: product.aggregateRating?.ratingValue
              ? parseFloat(product.aggregateRating.ratingValue)
              : undefined,
            reviewCount: product.aggregateRating?.reviewCount
              ? parseInt(product.aggregateRating.reviewCount)
              : undefined,
          };
        }
      } catch {
        // skip invalid JSON-LD
      }
    });

    let productData = holder.data;

    // Fallback: OpenGraph + meta tags
    if (!productData || productData.price === 0) {
      const name =
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="title"]').attr("content") ||
        $("h1").first().text().trim();

      const priceStr =
        $('meta[property="product:price:amount"]').attr("content") ||
        $('meta[property="og:price:amount"]').attr("content") ||
        "";
      const price = parsePrice(priceStr);

      const currency =
        $('meta[property="product:price:currency"]').attr("content") ||
        $('meta[property="og:price:currency"]').attr("content");

      const imageUrl = $('meta[property="og:image"]').attr("content") || undefined;

      productData = {
        name: productData?.name || name || "",
        price: price || productData?.price || 0,
        currency: productData?.currency || currency || "TRY",
        inStock: true,
        imageUrl: productData?.imageUrl || imageUrl,
      };
    }

    if (productData && (productData.name || productData.price > 0)) {
      return productData;
    }

    return null;
  };

  return scrapeWithFallbackCached(url, config, parseGenericHtml, "Generic");
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
    case "TEKNOSA":
    case "VATAN":
    case "DECATHLON":
      return scrapeGeneric;
    case "MEDIAMARKT":
      return scrapeMediaMarkt;
    default:
      // Fallback to generic for unknown marketplaces
      logger.warn(`No specific scraper for ${marketplace}, using generic`);
      return scrapeGeneric;
  }
}
