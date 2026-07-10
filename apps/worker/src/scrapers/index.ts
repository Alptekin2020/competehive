import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import type { Page } from "puppeteer";
import { logger } from "../utils/logger";
import { getCachedScrapeResult, setCachedScrapeResult } from "../utils/cache";
import { getProxyConfig } from "../utils/proxy";

// ============================================
// Scraper Types
// ============================================

// Aynı ilanı satan diğer satıcı (Trendyol "Diğer Satıcılar" / buybox rakibi).
// Ürün birebir aynı olduğundan bu kayıtlar kesin eşleşmedir (matchScore 100).
export interface ScrapedOtherSeller {
  merchantId: string;
  sellerName: string | null;
  price: number;
}

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
  otherSellers?: ScrapedOtherSeller[];
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

export function parsePrice(raw?: string | null): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[^\d.,]/g, "")
    .trim();
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let value: number;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      value = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    } else {
      value = parseFloat(cleaned.replace(/,/g, ""));
    }
  } else if (hasComma && !hasDot) {
    value = parseFloat(cleaned.replace(",", "."));
  } else if (hasDot && !hasComma) {
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      value = parseFloat(cleaned);
    } else {
      value = parseFloat(cleaned.replace(/\./g, ""));
    }
  } else {
    value = parseFloat(cleaned);
  }

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
// Puppeteer-based scraping fallback
// ============================================

let browserInstance: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  // A previously launched browser that crashed/disconnected must not be reused.
  browserInstance = null;

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";
  const proxy = getProxyConfig();

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
      // NOT: --single-process kaldırıldı. Chromium'un desteklemediği bu kip
      // prod'da launch'ı tamamen kırıyordu: loglarda her denemede "Failed to
      // launch the browser process" + "Cannot use V8 Proxy resolver in single
      // process mode" görülüyor ve Trendyol API+HTML 403 yediğinde son çare
      // olan Puppeteer hiç devreye giremiyordu. --no-zygote, süreç sayısını
      // launch'ı kırmadan azaltır (bellek hassasiyeti için güvenli alternatif).
      "--no-zygote",
      // Route Chromium through the proxy too (credentials, if any, are applied
      // per-page via page.authenticate — Chromium rejects them in this flag).
      ...(proxy ? [`--proxy-server=${proxy.server}`] : []),
    ],
  });

  // If Chromium crashes, drop the singleton so the next call relaunches it
  // instead of handing out a dead browser.
  browserInstance.on("disconnected", () => {
    browserInstance = null;
  });

  return browserInstance;
}

/**
 * Apply proxy credentials to a freshly created page when the proxy needs auth.
 * No-op when no proxy or no credentials are configured. Must run before goto().
 */
async function applyProxyAuth(page: Page): Promise<void> {
  const proxy = getProxyConfig();
  if (proxy?.username) {
    await page.authenticate({ username: proxy.username, password: proxy.password ?? "" });
  }
}

/** Close the shared Puppeteer browser (called on graceful shutdown). */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // already closed or crashed — nothing to do
    }
    browserInstance = null;
  }
}

interface PuppeteerFetchResult {
  html: string;
  finalUrl: string | null;
  title: string | null;
}

async function scrapeWithPuppeteer(
  url: string,
  config: ScraperConfig,
): Promise<PuppeteerFetchResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await applyProxyAuth(page);
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
    const finalUrl = page.url() || null;
    const title = await page.title().catch(() => null);
    return { html, finalUrl, title };
  } finally {
    await page.close();
  }
}

// Genel bot-koruma/challenge sayfası imzaları. Dönen değer teşhis loglarında
// kullanılır (hangi imza yakalandı) — null ise sayfa challenge görünmüyor.
// Trendyol/Hepsiburada'nın kendi özel tespitleri ayrıdır; bu, generic yol
// (N11, Amazon TR, Teknosa...) için ortak son kontroldür.
export function detectBotChallenge(html: string): string | null {
  const lower = html.toLowerCase();
  // Gerçek ürün sayfaları büyüktür; inline bundle'lardaki doğal "captcha"
  // kelimeleri yanlış pozitif üretmesin diye büyük gövdede yalnızca kesin
  // imzalara bakılır (Hepsiburada isAkamaiBlockHtml dersi).
  const definite = [
    'action="/errors/validatecaptcha', // Amazon robot check formu
    "api-services-support@amazon.com", // Amazon blok sayfası iletişim maili
    "px-captcha", // PerimeterX (n11 dahil bazı TR siteleri)
    "_incapsula_", // Imperva Incapsula
    "queue-it.net", // kuyruk sayfaları
  ];
  for (const marker of definite) {
    if (lower.includes(marker)) return marker;
  }
  if (html.length >= 50_000) return null;
  const smallPageMarkers = [
    "captcha",
    "just a moment",
    "checking your browser",
    "access denied",
    "erişim engellendi",
    "robot check",
    "olağandışı trafik",
  ];
  for (const marker of smallPageMarkers) {
    if (lower.includes(marker)) return marker;
  }
  return null;
}

// ============================================
// Extract Trendyol content ID from URL
// ============================================

function extractTrendyolContentId(url: string): string | null {
  // Trendyol URLs have pattern: ...p-{contentId}...
  const match = url.match(/p-(\d+)/);
  return match ? match[1] : null;
}

// URL belirli bir satıcının ilanına işaret ediyorsa (?merchantId=...) onu al.
// Aynı ürünü birden çok satıcı satar; merchantId'siz productDetail çağrısı
// buybox kazananının fiyatını döndürür — kullanıcının kendi ilanının değil.
function extractTrendyolMerchantId(url: string): string | null {
  const match = url.match(/[?&]merchantId=(\d+)/i);
  return match ? match[1] : null;
}

// productDetail yanıtındaki "Diğer Satıcılar" (otherMerchants) listesini ayıkla.
// Bu satıcılar aynı ilanın buybox rakipleridir — keşif hattı (Google araması)
// bunları hiçbir zaman bulamaz çünkü satıcı varyantı URL'leri ayrı sonuç olarak
// indekslenmez. Alan adları API sürümüne göre değişebildiği için savunmacı okunur.
export function parseTrendyolOtherMerchants(
  result: Record<string, unknown>,
  ownMerchantId: string | null,
): ScrapedOtherSeller[] {
  const raw = result.otherMerchants;
  if (!Array.isArray(raw)) return [];

  const sellers: ScrapedOtherSeller[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const merchant = entry.merchant as Record<string, unknown> | undefined;

    const idRaw = merchant?.id ?? entry.merchantId;
    if (idRaw == null) continue;
    const merchantId = String(idRaw);
    if (ownMerchantId && merchantId === ownMerchantId) continue;

    const price = entry.price as Record<string, unknown> | undefined;
    const discounted = price?.discountedPrice as Record<string, unknown> | undefined;
    const selling = price?.sellingPrice as Record<string, unknown> | undefined;
    const priceValue =
      (typeof discounted?.value === "number" ? discounted.value : 0) ||
      (typeof selling?.value === "number" ? selling.value : 0) ||
      (typeof entry.price === "number" ? entry.price : 0);
    if (!priceValue || priceValue <= 0) continue;

    const name = merchant?.name;
    sellers.push({
      merchantId,
      sellerName: typeof name === "string" && name.trim() ? name.trim() : null,
      price: priceValue,
    });
  }
  return sellers;
}

// ============================================
// Parse HTML for Trendyol product data
// ============================================

export function parseTrendyolHtml(html: string): ScrapedProduct | null {
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
      // Trendyol "envoy" vitrin yenilemesiyle bazı ürün sayfaları artık düz
      // Product yerine varyant grubunu temsil eden ProductGroup şeması
      // yayınlıyor (prod vakası: Philips HD9650/90, 2026-07 — eski
      // __PRODUCT_DETAIL_APP_INITIAL_STATE__ global'i de kaldırılmıştı).
      // Grup seviyesindeki offers sayfada seçili varyantın fiyatını taşır;
      // grup fiyatı yoksa/0 ise ilk hasVariant girdisine düşüyoruz.
      if (ld["@type"] === "Product" || ld["@type"] === "ProductGroup") {
        const groupOffer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        const firstVariant = Array.isArray(ld.hasVariant) ? ld.hasVariant[0] : ld.hasVariant;
        const variantOffer = Array.isArray(firstVariant?.offers)
          ? firstVariant.offers[0]
          : firstVariant?.offers;
        const groupPrice = parsePrice(String(groupOffer?.price ?? ""));
        const offer = groupPrice > 0 ? groupOffer : (variantOffer ?? groupOffer);
        const imageContentUrl = Array.isArray(ld.image?.contentUrl)
          ? ld.image.contentUrl[0]
          : ld.image?.contentUrl;
        holder.data = {
          name: ld.name || "",
          price: parsePrice(String(offer?.price ?? "")),
          currency: offer?.priceCurrency || "TRY",
          inStock: offer?.availability?.includes("InStock") ?? true,
          imageUrl:
            imageContentUrl ||
            (Array.isArray(ld.image) ? ld.image[0] : undefined) ||
            (typeof ld.image === "string" ? ld.image : undefined),
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
    const price = parsePrice(priceText);
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
              // Kampanya varken müşterinin gördüğü fiyat discountedPrice'tır.
              pd.price =
                pd.price ||
                product.price?.discountedPrice?.value ||
                product.price?.sellingPrice?.value ||
                product.price?.originalPrice?.value;
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

type TrendyolFetchErrorShape = {
  name?: string;
  message?: string;
  code?: string;
  cause?: {
    name?: string;
    message?: string;
    code?: string;
    errno?: number;
    syscall?: string;
    address?: string;
    hostname?: string;
  };
  stack?: string;
};

type TrendyolPuppeteerErrorShape = {
  name?: string;
  message?: string;
  stack?: string;
};

export async function scrapeTrendyol(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  const cached = await getCachedScrapeResult<ScrapedProduct>(url);
  if (cached) return cached;

  logger.info(`Scraping Trendyol: ${url}`);

  let lastApiError: TrendyolFetchErrorShape | null = null;
  let lastHtmlError: TrendyolFetchErrorShape | null = null;
  let lastHtmlStatus: number | null = null;
  let lastHtmlLen: number | null = null;
  let lastHtmlCfRay: string | null = null;
  let lastHtmlIsBotChallenge: boolean = false;
  let lastPuppeteerError: TrendyolPuppeteerErrorShape | null = null;
  let puppeteerFinalUrl: string | null = null;
  let puppeteerContentLength: number | null = null;
  let puppeteerHasInitialState: boolean = false;

  // Strategy 1: Use Trendyol public API (most reliable from cloud IPs)
  // NOT: public.trendyol.com DNS'ten kaldırıldı (NXDOMAIN — üretimde kalıcı
  // ENOTFOUND'un nedeni buydu). Aynı productgw servisi apigw üzerinden sunuluyor.
  const contentId = extractTrendyolContentId(url);
  const merchantId = extractTrendyolMerchantId(url);
  if (contentId) {
    const apiUrl = `https://apigw.trendyol.com/discovery-web-productgw-service/api/productDetail/${contentId}${
      merchantId ? `?merchantId=${merchantId}` : ""
    }`;
    logger.info(`Trying Trendyol API: contentId=${contentId} merchantId=${merchantId ?? "none"}`);
    const apiRetries = 2;
    let apiData: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= apiRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout || 15000);
      try {
        const headers: Record<string, string> = {
          "User-Agent": config.userAgent || getRandomUserAgent(),
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: "https://www.trendyol.com/",
          Origin: "https://www.trendyol.com",
        };
        const response = await fetch(apiUrl, {
          headers,
          signal: controller.signal,
          redirect: "follow",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        apiData = (await response.json()) as Record<string, unknown>;
        clearTimeout(timeout);
        lastApiError = null;
        break;
      } catch (err) {
        clearTimeout(timeout);
        const e = err as TrendyolFetchErrorShape;
        const cause = e?.cause;
        lastApiError = e;
        const errCode = e?.code || cause?.code || "unknown";
        const errMsg = (e?.message || cause?.message || "no-message").slice(0, 150);
        const errSyscall = cause?.syscall || "none";
        const errHostname = cause?.hostname || "none";
        logger.warn(
          `Trendyol API fail attempt=${attempt}: code=${errCode} syscall=${errSyscall} hostname=${errHostname} msg="${errMsg}"`,
        );
        // DNS çözülmüyorsa (Railway'de public.trendyol.com ENOTFOUND) retry
        // boşuna — 2-4 sn bekleyip aynı hatayı almak yerine HTML yoluna geç.
        if (errCode === "ENOTFOUND") break;
        if (attempt < apiRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    if (apiData) {
      const result = apiData?.result as Record<string, unknown> | undefined;
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

        // merchantId istenmişse yanıtın gerçekten o satıcıya ait olduğunu
        // doğrula — API parametreyi yok sayarsa buybox fiyatı döner ve yanlış
        // satıcının fiyatı kaydedilir. Yanıtta merchant.id hiç yoksa da
        // doğrulanamıyor demektir. Uyuşmazlıkta önce istenen satıcıyı
        // otherMerchants içinde ara (satıcı orada fiyatıyla listelenir);
        // bulunamazsa HTML stratejisine düş.
        const responseMerchantId =
          merchant?.id != null ? String(merchant.id as string | number) : null;
        const merchantMismatch = merchantId !== null && responseMerchantId !== merchantId;

        if (merchantMismatch) {
          const allSellers = parseTrendyolOtherMerchants(result, null);
          // Buybox kazananı otherMerchants'ta yer almaz — istenen satıcının
          // rakibi olarak listeye eklenir.
          if (responseMerchantId && priceValue > 0) {
            allSellers.push({
              merchantId: responseMerchantId,
              sellerName: typeof merchant?.name === "string" ? merchant.name : null,
              price: priceValue,
            });
          }
          const requestedSeller = allSellers.find((s) => s.merchantId === merchantId);
          if (requestedSeller) {
            const product: ScrapedProduct = {
              name: (result.name as string) || (result.productName as string) || "",
              price: requestedSeller.price,
              currency: "TRY",
              inStock: true,
              imageUrl: images?.[0] ? `https://cdn.dsmcdn.com/${images[0]}` : undefined,
              category: (category?.name as string) || undefined,
              sellerName: requestedSeller.sellerName ?? undefined,
              otherSellers: allSellers.filter((s) => s.merchantId !== merchantId),
            };
            logger.info(
              `Trendyol API: istenen satıcı otherMerchants içinde bulundu (merchantId=${merchantId}) — ${product.price} TRY`,
            );
            await setCachedScrapeResult(url, product);
            return product;
          }
          logger.warn(
            `Trendyol API merchant mismatch: requested=${merchantId} got=${responseMerchantId ?? "unknown"} — falling back to HTML`,
          );
        } else if (priceValue > 0) {
          // Hariç tutulacak satıcı: yanıtın ana satıcısı (ürünün kendisi) —
          // merchantId'siz URL'de buybox kazananı, merchantId'li URL'de zaten
          // istenen satıcıyla aynı (mismatch kontrolünden geçti).
          const otherSellers = parseTrendyolOtherMerchants(
            result,
            responseMerchantId ?? merchantId,
          );
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
            otherSellers: otherSellers.length > 0 ? otherSellers : undefined,
          };

          logger.info(
            `Trendyol API success: ${product.name} - ${product.price} ${product.currency}`,
          );
          await setCachedScrapeResult(url, product);
          return product;
        }
      }

      logger.warn("Trendyol API returned data but no valid price, trying other methods");
    }
  }

  // Strategy 2: Direct HTML fetch
  const htmlRetries = 3;
  let html = "";
  for (let attempt = 1; attempt <= htmlRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout || 15000);
    try {
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
      lastHtmlStatus = response.status;
      const body = await response.text();
      lastHtmlLen = body.length;
      clearTimeout(timeout);

      const htmlSnippetRaw = body.slice(0, 300).replace(/\s+/g, " ").trim();
      const htmlLower = body.toLowerCase();
      const isJustAMoment =
        htmlLower.includes("just a moment") || htmlLower.includes("checking your browser");
      const isCaptcha =
        htmlLower.includes("captcha") ||
        htmlLower.includes("hcaptcha") ||
        htmlLower.includes("recaptcha");
      const isAccessDenied =
        htmlLower.includes("access denied") ||
        htmlLower.includes("you are unable to access") ||
        htmlLower.includes("attention required");
      const hasInitialState = body.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__");
      const cfRay = response.headers.get("cf-ray") || "none";
      const cfMitigated = response.headers.get("cf-mitigated") || "none";
      const server = response.headers.get("server") || "none";

      lastHtmlCfRay = cfRay !== "none" ? cfRay : null;
      lastHtmlIsBotChallenge = isJustAMoment || isCaptcha || isAccessDenied;

      const urlTail = url.split("/").filter(Boolean).slice(-1)[0]?.slice(0, 50) || "unknown";
      logger.info(
        `Trendyol HTML [${urlTail}] attempt=${attempt}: status=${response.status} len=${body.length} ` +
          `cfRay=${cfRay} cfMitigated=${cfMitigated} server=${server} ` +
          `hasInitialState=${hasInitialState} isJustAMoment=${isJustAMoment} isCaptcha=${isCaptcha} isAccessDenied=${isAccessDenied} ` +
          `snippet="${htmlSnippetRaw.slice(0, 200)}"`,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      html = body;
      lastHtmlError = null;
      break;
    } catch (err) {
      clearTimeout(timeout);
      const e = err as TrendyolFetchErrorShape;
      lastHtmlError = e;
      const cause = e?.cause;
      const errCode = e?.code || cause?.code || "unknown";
      const errMsg = (e?.message || cause?.message || "no-message").slice(0, 150);
      logger.warn(`Trendyol HTML fetch threw attempt=${attempt}: code=${errCode} msg="${errMsg}"`);
      if (attempt < htmlRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  if (html) {
    const product = parseTrendyolHtml(html);
    if (product && product.price > 0) {
      logger.info(`Trendyol HTML scraped: ${product.name} - ${product.price} ${product.currency}`);
      await setCachedScrapeResult(url, product);
      return product;
    }

    // Parse başarısızlığında format-marker raporu: sayfada hangi veri
    // kaynaklarının bulunduğunu tek satırda loglar. Ham HTML dökümü üretim
    // log hacmini şişirdiği için kaldırıldı; markerlar tanı için yeterli.
    if (!product || !product.name || !product.price) {
      const hasJsonLd = html.includes("application/ld+json");
      const hasProductGroupLd = html.includes('"@type":"ProductGroup"');
      const hasNextData = html.includes("__NEXT_DATA__");
      const hasInitialState = html.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__");
      const hasOgPrice =
        html.includes('property="product:price') || html.includes('property="og:price');
      const hasItemprop = html.includes('itemprop="price"');
      const hasInlineWindow = html.includes("window.__") || html.includes("window['__");

      logger.warn(
        `Trendyol PARSE-FAIL markers: jsonLd=${hasJsonLd} productGroupLd=${hasProductGroupLd} nextData=${hasNextData} initialState=${hasInitialState} ogPrice=${hasOgPrice} itemprop=${hasItemprop} inlineWindow=${hasInlineWindow}`,
      );
    }

    logger.warn("Trendyol HTML fetch returned no product data, trying Puppeteer");
  }

  // Strategy 3: Puppeteer (handles JS-rendered pages and bot protection)
  try {
    logger.info("Attempting Trendyol scrape with Puppeteer");
    const browser = await getBrowser();
    const page = await browser.newPage();
    let pageHtml = "";
    try {
      await applyProxyAuth(page);
      await page.setUserAgent(config.userAgent || getRandomUserAgent());
      await page.setExtraHTTPHeaders({
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      });
      // AB veri merkezi IP'leri uluslararası vitrine (/en, EUR fiyat) coğrafi
      // yönlendirmeye takılıyor — TR vitrinini çerezle sabitlemeyi dene.
      await page.setCookie(
        { name: "countryCode", value: "TR", domain: ".trendyol.com", path: "/" },
        { name: "storefrontId", value: "1", domain: ".trendyol.com", path: "/" },
        { name: "language", value: "tr", domain: ".trendyol.com", path: "/" },
      );

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.timeout || 30000,
        });
        await new Promise((r) => setTimeout(r, 3000));
        pageHtml = await page.content();
        puppeteerFinalUrl = page.url();

        // Coğrafi yönlendirme uluslararası bir vitrine düşürdüyse (TL fiyat
        // yok) TR yoluna bir kez daha zorla — site çerezleri artık yüklü
        // olduğundan ikinci deneme TR'de kalabilir. IP'nin ülkesine göre
        // /en dışında /de, /ro, /pl gibi vitrinlere de yönlendirme olabilir.
        const intlPathRegex = /^\/(en|de|ar|ro|pl|cs|sk|hu|el|bg|uk|rs)(\/|$)/;
        const landedOnIntl = (u: string | null) => {
          if (!u) return false;
          try {
            return intlPathRegex.test(new URL(u).pathname);
          } catch {
            return false;
          }
        };
        if (landedOnIntl(puppeteerFinalUrl)) {
          const retryUrlObj = new URL(puppeteerFinalUrl!);
          retryUrlObj.pathname = retryUrlObj.pathname.replace(intlPathRegex, "/");
          const trRetryUrl = retryUrlObj.toString();
          logger.info(
            `Trendyol Puppeteer uluslararası vitrin yönlendirmesi — TR retry: ${trRetryUrl.slice(0, 100)}`,
          );
          await page.goto(trRetryUrl, {
            waitUntil: "domcontentloaded",
            timeout: config.timeout || 30000,
          });
          await new Promise((r) => setTimeout(r, 3000));
          pageHtml = await page.content();
          puppeteerFinalUrl = page.url();
        }
        // Hâlâ uluslararası vitrindeysek sayfayı AYRIŞTIRMA — EUR/RON vb.
        // fiyatın TL sanılıp yazılmasındansa taramanın başarısız sayılması
        // güvenlidir. Son kapı yol önekine değil <html lang="..."> özniteliğine
        // bakar: tüm dilleri kapsar ve iki harfli marka yollarında yanlış
        // pozitif üretmez.
        const htmlLangMatch = pageHtml.match(/<html[^>]*\blang="([a-zA-Z-]+)"/);
        const htmlLang = htmlLangMatch ? htmlLangMatch[1].toLowerCase() : null;
        if (landedOnIntl(puppeteerFinalUrl) || (htmlLang !== null && !htmlLang.startsWith("tr"))) {
          logger.warn(
            `Trendyol Puppeteer uluslararası vitrinde kaldı (finalUrl=${puppeteerFinalUrl?.slice(0, 100)} lang=${htmlLang ?? "yok"}) — sonuç reddedildi`,
          );
          pageHtml = "";
        }
        puppeteerContentLength = pageHtml.length;
        puppeteerHasInitialState = pageHtml.includes("__PRODUCT_DETAIL_APP_INITIAL_STATE__");

        const pupSnippet = pageHtml.slice(0, 200).replace(/\s+/g, " ").trim();
        const pupLower = pageHtml.toLowerCase();
        const pupIsBotChallenge =
          pupLower.includes("captcha") ||
          pupLower.includes("just a moment") ||
          pupLower.includes("attention required");
        const titleTag = await page.title().catch(() => null);
        const urlTail = url.split("/").filter(Boolean).slice(-1)[0]?.slice(0, 50) || "unknown";

        logger.info(
          `Trendyol Puppeteer [${urlTail}]: finalUrl=${puppeteerFinalUrl?.slice(0, 100)} ` +
            `len=${puppeteerContentLength} hasInitialState=${puppeteerHasInitialState} isBotChallenge=${pupIsBotChallenge} ` +
            `title="${(titleTag || "").slice(0, 80)}" snippet="${pupSnippet}"`,
        );
      } catch (err) {
        const e = err as TrendyolPuppeteerErrorShape;
        lastPuppeteerError = e;
        try {
          puppeteerFinalUrl = page.url();
        } catch {
          puppeteerFinalUrl = null;
        }
        logger.warn(
          `Trendyol Puppeteer fail: name=${e?.name || "unknown"} msg="${(e?.message || "no-msg").slice(0, 200)}" ` +
            `finalUrl=${puppeteerFinalUrl || "none"}`,
        );
        throw err;
      }
    } finally {
      await page.close();
    }

    if (pageHtml) {
      const product = parseTrendyolHtml(pageHtml);
      if (product && product.price > 0) {
        logger.info(
          `Trendyol Puppeteer scraped: ${product.name} - ${product.price} ${product.currency}`,
        );
        await setCachedScrapeResult(url, product);
        return product;
      }
    }
  } catch (err) {
    const e = err as TrendyolPuppeteerErrorShape;
    if (!lastPuppeteerError) lastPuppeteerError = e;
    logger.warn(`Trendyol Puppeteer scrape failed: ${errorMessage(err)}`);
  }

  const apiErrSummary =
    lastApiError?.cause?.code ||
    lastApiError?.code ||
    lastApiError?.message?.slice(0, 50) ||
    "unknown";
  const htmlErrSummary = lastHtmlStatus
    ? `status=${lastHtmlStatus},len=${lastHtmlLen},cfRay=${lastHtmlCfRay || "none"},isBotChallenge=${lastHtmlIsBotChallenge}`
    : lastHtmlError?.message?.slice(0, 80) || "unknown";
  const puppeteerErrSummary = lastPuppeteerError
    ? `${lastPuppeteerError?.name || "Error"}: ${(lastPuppeteerError?.message || "no-msg").slice(0, 100)}`
    : puppeteerContentLength
      ? `content-len=${puppeteerContentLength},hasInitialState=${puppeteerHasInitialState}`
      : "never-ran";

  logger.error(
    `Trendyol all-fail summary: url=${url} | API: ${apiErrSummary} | HTML: ${htmlErrSummary} | Puppeteer: ${puppeteerErrSummary}`,
  );

  throw new ScraperError(
    `Trendyol urun bilgileri tum yontemlerle cekilemedi (API: ${apiErrSummary}, HTML: ${htmlErrSummary}, Puppeteer: ${puppeteerErrSummary})`,
    {
      code: "SCRAPE_ALL_METHODS_FAILED",
      retryable: true,
      softFail: false,
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
  const urlTail = url.split("/").filter(Boolean).slice(-1)[0]?.slice(0, 50) || "unknown";
  // Teşhis özeti: üretimde "cekilemedi (HTML + Puppeteer)" tek satırı hangi
  // aşamanın neden düştüğünü söylemiyordu (N11 prod vakası günlerce kör
  // kaldı). Trendyol scraper'ındaki detay seviyesi generic yola da uygulanır.
  let htmlFailSummary = "never-ran";
  let puppeteerFailSummary = "never-ran";

  // Strategy 1: Direct HTML fetch
  try {
    const html = await fetchWithRetry(url, config);
    const challenge = detectBotChallenge(html);
    const product = challenge ? null : parseHtml(html);
    if (product && product.price > 0) {
      logger.info(
        `${marketplaceName} HTML scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      return product;
    }
    htmlFailSummary = challenge
      ? `challenge=${challenge},len=${html.length}`
      : `parse-fail,len=${html.length}`;
    logger.warn(
      `${marketplaceName} HTML [${urlTail}]: len=${html.length} challenge=${challenge ?? "none"} ` +
        `parsed=${product ? `name=${!!product.name},price=${product.price}` : "null"} — trying Puppeteer`,
    );
  } catch (error) {
    htmlFailSummary = errorMessage(error).slice(0, 80);
    logger.warn(`${marketplaceName} HTML fetch failed: ${errorMessage(error)}, trying Puppeteer`);
  }

  // Strategy 2: Puppeteer fallback
  try {
    logger.info(`Attempting ${marketplaceName} scrape with Puppeteer`);
    const { html, finalUrl, title } = await scrapeWithPuppeteer(url, config);
    const challenge = detectBotChallenge(html);
    const product = challenge ? null : parseHtml(html);

    logger.info(
      `${marketplaceName} Puppeteer [${urlTail}]: finalUrl=${finalUrl?.slice(0, 100) ?? "none"} ` +
        `len=${html.length} challenge=${challenge ?? "none"} title="${(title || "").slice(0, 80)}" ` +
        `parsed=${product ? `name=${!!product.name},price=${product.price}` : "null"}`,
    );

    if (product && product.price > 0) {
      logger.info(
        `${marketplaceName} Puppeteer scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      return product;
    }
    puppeteerFailSummary = challenge
      ? `challenge=${challenge},len=${html.length}`
      : `parse-fail,len=${html.length},finalUrl=${finalUrl?.slice(0, 80) ?? "none"}`;
  } catch (error) {
    puppeteerFailSummary = errorMessage(error).slice(0, 100);
    logger.warn(`${marketplaceName} Puppeteer scrape failed: ${errorMessage(error)}`);
  }

  throw new ScraperError(
    `${marketplaceName} urun bilgileri cekilemedi (HTML: ${htmlFailSummary} | Puppeteer: ${puppeteerFailSummary})`,
    {
      code: "SCRAPE_ALL_METHODS_FAILED",
      retryable: true,
    },
  );
}

// ============================================
// HEPSIBURADA SCRAPER
// ============================================
//
// Hepsiburada Akamai Bot Manager arkasındadır — direkt HTTP fetch çoğu zaman
// 403 ile dönüyor (server: AkamaiGHost). Bu yüzden:
//   1) HTTP'de Akamai bloku hızlı tespit edip retry'lara zaman harcamadan
//      Puppeteer'a düşüyoruz.
//   2) Parser birden çok stratejiyi sırayla deniyor: JSON-LD (@graph dahil),
//      __NEXT_DATA__ (Hepsiburada Next.js), OG meta, modern CSS selektörleri.
//   3) Tanılama logları Trendyol scraper'ı ile aynı detay seviyesinde.

type HepsiburadaFetchErrorShape = {
  name?: string;
  message?: string;
  code?: string;
  cause?: {
    name?: string;
    message?: string;
    code?: string;
    errno?: number;
    syscall?: string;
    address?: string;
    hostname?: string;
  };
  stack?: string;
};

type HepsiburadaPuppeteerErrorShape = {
  name?: string;
  message?: string;
  stack?: string;
};

export function isAkamaiBlockHtml(html: string, status: number, server: string | null): boolean {
  if (status === 403 && server && server.toLowerCase().includes("akamai")) return true;
  // Gerçek blok/challenge sayfaları KÜÇÜKTÜR (gözlemlenen: ~2KB, 403 +
  // "hepsiburada | güvenlik" başlığı). Gerçek ürün sayfaları ise 100KB+ olur
  // ve inline SPA bundle'ları güvenlik sayfası şablonunu ("güvenlik" başlık
  // dizesi) ve "akamai"+"iframe" kelimelerini doğal olarak İÇERİR — imza
  // taraması büyük gövdede yapılırsa 200'lük gerçek ürün sayfası blok sanılıp
  // çöpe atılır (üretimde 607KB'lik sayfa bu yüzden hiç ayrıştırılmadı).
  if (html.length >= 50_000) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes("hepsiburada | güvenlik") ||
    lower.includes("hepsiburada | guvenlik") ||
    (lower.includes("akamai") && lower.includes("iframe"))
  );
}

function pickHepsiburadaImage(image: unknown): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const item of image) {
      const resolved = pickHepsiburadaImage(item);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (typeof image === "object") {
    const obj = image as Record<string, unknown>;
    if (typeof obj.contentUrl === "string") return obj.contentUrl;
    if (typeof obj.url === "string") return obj.url;
  }
  return undefined;
}

function extractFromHepsiburadaJsonLd($: cheerio.CheerioAPI): Partial<ScrapedProduct> {
  const collected: Partial<ScrapedProduct> = {};

  $('script[type="application/ld+json"]').each((_, el) => {
    if (collected.price && collected.price > 0 && collected.name) return;
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const candidates: Record<string, unknown>[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") candidates.push(item);
        }
      } else if (parsed && typeof parsed === "object") {
        candidates.push(parsed);
        const graph = (parsed as Record<string, unknown>)["@graph"];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            if (item && typeof item === "object") candidates.push(item as Record<string, unknown>);
          }
        }
      }

      for (const node of candidates) {
        if (node["@type"] !== "Product") continue;
        const offers = node.offers as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined;
        const offer = (Array.isArray(offers) ? offers[0] : offers) as
          | Record<string, unknown>
          | undefined;
        const offerPrice = offer ? parsePrice(String(offer.price ?? "")) : 0;
        if (!collected.name && typeof node.name === "string") collected.name = node.name;
        if ((!collected.price || collected.price === 0) && offerPrice > 0) {
          collected.price = offerPrice;
        }
        if (!collected.currency && typeof offer?.priceCurrency === "string") {
          collected.currency = offer.priceCurrency as string;
        }
        if (collected.inStock === undefined && typeof offer?.availability === "string") {
          collected.inStock = offer.availability.toLowerCase().includes("instock");
        }
        if (!collected.imageUrl) {
          const img = pickHepsiburadaImage(node.image);
          if (img) collected.imageUrl = img;
        }
        const seller = offer?.seller as Record<string, unknown> | undefined;
        if (!collected.sellerName && typeof seller?.name === "string") {
          collected.sellerName = seller.name as string;
        }
        const aggregateRating = node.aggregateRating as Record<string, unknown> | undefined;
        if (!collected.rating && aggregateRating?.ratingValue) {
          const rating = parseFloat(String(aggregateRating.ratingValue));
          if (Number.isFinite(rating)) collected.rating = rating;
        }
        if (!collected.reviewCount && aggregateRating?.reviewCount) {
          const reviewCount = parseInt(String(aggregateRating.reviewCount));
          if (Number.isFinite(reviewCount)) collected.reviewCount = reviewCount;
        }
      }
    } catch {
      // malformed JSON-LD block — skip silently
    }
  });

  return collected;
}

function extractFromHepsiburadaNextData($: cheerio.CheerioAPI): Partial<ScrapedProduct> {
  const raw = $("script#__NEXT_DATA__").html();
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const props = data?.props?.pageProps;
    const product =
      props?.product ?? props?.productData ?? props?.initialState?.product ?? props?.data?.product;
    if (!product || typeof product !== "object") return {};

    const result: Partial<ScrapedProduct> = {};
    if (typeof product.name === "string") result.name = product.name;
    else if (typeof product.title === "string") result.name = product.title;

    const priceCandidates = [
      product.price?.value,
      product.price?.discountedPrice,
      product.price?.amount,
      product.price?.sellingPrice,
      product.discountedPrice?.value,
      product.discountedPrice,
      product.sellingPrice?.value,
      product.sellingPrice,
      product.finalPrice,
    ];
    for (const candidate of priceCandidates) {
      if (candidate == null) continue;
      const numeric = typeof candidate === "number" ? candidate : parsePrice(String(candidate));
      if (numeric > 0) {
        result.price = numeric;
        break;
      }
    }

    const image = pickHepsiburadaImage(product.image ?? product.images ?? product.imageUrl);
    if (image) result.imageUrl = image;

    const merchant = product.merchant ?? product.seller;
    if (merchant && typeof merchant === "object") {
      const merchantName = (merchant as Record<string, unknown>).name;
      if (typeof merchantName === "string") result.sellerName = merchantName;
    }

    if (typeof product.inStock === "boolean") result.inStock = product.inStock;
    else if (typeof product.isInStock === "boolean") result.inStock = product.isInStock;
    else if (typeof product.stock === "number") result.inStock = product.stock > 0;

    return result;
  } catch {
    return {};
  }
}

function cleanHepsiburadaTitle(title: string): string {
  return title
    .replace(/\s*[-–|]\s*Hepsiburada.*$/i, "")
    .replace(/\s*[-–|]\s*Fiyatı.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHepsiburadaHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const jsonLd = extractFromHepsiburadaJsonLd($);
  const nextData = extractFromHepsiburadaNextData($);

  const ogTitle = $("meta[property='og:title']").attr("content") || "";
  const ogImage = $("meta[property='og:image']").attr("content") || undefined;
  const ogPriceRaw =
    $("meta[property='product:price:amount']").attr("content") ||
    $("meta[property='product:sale_price:amount']").attr("content") ||
    $("meta[property='og:price:amount']").attr("content") ||
    $("meta[itemprop='price']").attr("content") ||
    $("meta[name='price']").attr("content") ||
    "";
  const ogPrice = ogPriceRaw ? parsePrice(ogPriceRaw) : 0;
  const ogCurrency =
    $("meta[property='product:price:currency']").attr("content") ||
    $("meta[property='og:price:currency']").attr("content") ||
    undefined;

  const htmlName =
    $("h1#product-name").first().text().trim() ||
    $("h1.product-name").first().text().trim() ||
    $("h1[data-test-id='title']").first().text().trim() ||
    $("[data-test-id='product-name']").first().text().trim() ||
    $("h1[itemprop='name']").first().text().trim() ||
    $("h1").first().text().trim();

  const htmlPriceText =
    $("[data-test-id='price-current-price']").first().text().trim() ||
    $("[data-test-id='default-price']").first().text().trim() ||
    $("[data-test-id='price']").first().text().trim() ||
    $("[data-test-id='offering-price']").first().text().trim() ||
    $("[data-bind*='price'], [data-bind*='Price']").first().text().trim() ||
    $("span[itemprop='price']").first().attr("content") ||
    $("span[itemprop='price']").first().text().trim() ||
    $("[itemprop='price']").first().attr("content") ||
    $(".product-price").first().text().trim() ||
    $(".price-value").first().text().trim() ||
    $("[class*='price-current'], [class*='priceCurrent']").first().text().trim() ||
    $("[class*='Price-module']").first().text().trim() ||
    "";
  const htmlPrice = parsePrice(htmlPriceText);

  // Açıklama meta tag'ında ve title'da "100 TL" gibi fiyat geçebilir — son çare regex tarama
  let descPrice = 0;
  if (!htmlPrice) {
    const descContent =
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      "";
    const priceMatch = descContent.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:TL|₺|TRY)/i);
    if (priceMatch) {
      const parsed = parsePrice(priceMatch[1]);
      if (parsed > 0) descPrice = parsed;
    }
  }

  // Hidden script tag'lardan inline ürün state'i çekme (Hepsiburada bazen NextData'yı id'siz koyar)
  let inlineScriptPrice = 0;
  if (!htmlPrice && !descPrice) {
    $("script").each((_, el) => {
      if (inlineScriptPrice > 0) return;
      const text = $(el).html() || "";
      if (!text || text.length > 200000) return;
      const idx = text.search(/"(?:offeredPrice|salePrice|finalPrice|sellingPrice)"\s*:\s*\d/);
      if (idx < 0) return;
      const m = text.slice(idx, idx + 200).match(/:\s*(\d+(?:\.\d+)?)/);
      if (m) {
        const parsed = parseFloat(m[1]);
        if (Number.isFinite(parsed) && parsed > 0) inlineScriptPrice = parsed;
      }
    });
  }

  const htmlImage =
    $("img[data-test-id='product-image']").first().attr("src") ||
    $("img[itemprop='image']").first().attr("src") ||
    $("img.product-image").first().attr("src") ||
    $(".product-image img").first().attr("src");

  const htmlSeller =
    $("[data-test-id='merchant-name']").first().text().trim() ||
    $("[data-test-id='seller-name']").first().text().trim() ||
    $(".merchant-name").first().text().trim() ||
    "";

  const rawTitle = jsonLd.name || nextData.name || htmlName || ogTitle || "";
  const cleanName = cleanHepsiburadaTitle(rawTitle);

  const priceValue = [
    jsonLd.price,
    nextData.price,
    htmlPrice,
    ogPrice,
    inlineScriptPrice,
    descPrice,
  ].find((v): v is number => typeof v === "number" && v > 0);

  const lower = html.toLowerCase();
  const outOfStock =
    lower.includes("tükendi") ||
    lower.includes("tukendi") ||
    lower.includes("stokta yok") ||
    lower.includes("out-of-stock") ||
    lower.includes('"instock":false');
  const inStockResolved = jsonLd.inStock ?? nextData.inStock ?? (outOfStock ? false : true);

  if (!cleanName && !priceValue) return null;

  return {
    name: cleanName || "Hepsiburada ürünü",
    price: priceValue ?? 0,
    currency: jsonLd.currency || ogCurrency || "TRY",
    inStock: inStockResolved,
    sellerName: jsonLd.sellerName || nextData.sellerName || htmlSeller || undefined,
    imageUrl: jsonLd.imageUrl || nextData.imageUrl || htmlImage || ogImage || undefined,
    rating: jsonLd.rating,
    reviewCount: jsonLd.reviewCount,
  };
}

export async function scrapeHepsiburada(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  const cached = await getCachedScrapeResult<ScrapedProduct>(url);
  if (cached) return cached;

  logger.info(`Scraping Hepsiburada: ${url}`);

  let lastHtmlError: HepsiburadaFetchErrorShape | null = null;
  let lastHtmlStatus: number | null = null;
  let lastHtmlLen: number | null = null;
  let lastHtmlServer: string | null = null;
  let lastHtmlIsAkamaiBlock = false;
  let lastPuppeteerError: HepsiburadaPuppeteerErrorShape | null = null;
  let puppeteerFinalUrl: string | null = null;
  let puppeteerContentLength: number | null = null;
  let puppeteerHasJsonLd = false;
  let puppeteerHasNextData = false;

  // Strategy 1: Direct HTML fetch (hızlı çıkış: Akamai blokunu görürsek retry yapma)
  const htmlRetries = 2;
  let html = "";
  for (let attempt = 1; attempt <= htmlRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout || 15000);
    try {
      const headers: Record<string, string> = {
        "User-Agent": config.userAgent || getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      };
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });
      lastHtmlStatus = response.status;
      const body = await response.text();
      lastHtmlLen = body.length;
      lastHtmlServer = response.headers.get("server");
      clearTimeout(timeout);

      const akamaiBlocked = isAkamaiBlockHtml(body, response.status, lastHtmlServer);
      lastHtmlIsAkamaiBlock = akamaiBlocked;

      const urlTail = url.split("/").filter(Boolean).slice(-1)[0]?.slice(0, 60) || "unknown";
      logger.info(
        `Hepsiburada HTML [${urlTail}] attempt=${attempt}: status=${response.status} len=${body.length} ` +
          `server=${lastHtmlServer || "none"} akamaiBlock=${akamaiBlocked}`,
      );

      if (akamaiBlocked) {
        // Akamai blokunda retry yapmak boşa — direkt Puppeteer'a düş
        lastHtmlError = { message: `Akamai bot block (${response.status})` };
        break;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      html = body;
      lastHtmlError = null;
      break;
    } catch (err) {
      clearTimeout(timeout);
      const e = err as HepsiburadaFetchErrorShape;
      lastHtmlError = e;
      const cause = e?.cause;
      const errCode = e?.code || cause?.code || "unknown";
      const errMsg = (e?.message || cause?.message || "no-message").slice(0, 150);
      logger.warn(
        `Hepsiburada HTML fetch threw attempt=${attempt}: code=${errCode} msg="${errMsg}"`,
      );
      if (attempt < htmlRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  if (html) {
    const product = parseHepsiburadaHtml(html);
    if (product && product.price > 0) {
      logger.info(
        `Hepsiburada HTML scraped: ${product.name} - ${product.price} ${product.currency}`,
      );
      await setCachedScrapeResult(url, product);
      return product;
    }

    if (!product || !product.name || product.price === 0) {
      const hasJsonLd = html.includes("application/ld+json");
      const hasNextData = html.includes("__NEXT_DATA__");
      const hasOgPrice =
        html.includes('property="product:price') || html.includes('property="og:price');
      const hasItemprop = html.includes('itemprop="price"');
      logger.warn(
        `Hepsiburada PARSE-FAIL markers: jsonLd=${hasJsonLd} nextData=${hasNextData} ogPrice=${hasOgPrice} itemprop=${hasItemprop}`,
      );
    }

    logger.warn("Hepsiburada HTML returned no product data, trying Puppeteer");
  }

  // Strategy 2: Puppeteer (Akamai bot challenge'ını JS rendering ile geçer)
  try {
    logger.info("Attempting Hepsiburada scrape with Puppeteer");
    const browser = await getBrowser();
    const page = await browser.newPage();
    let pageHtml = "";
    try {
      await applyProxyAuth(page);
      await page.setUserAgent(config.userAgent || getRandomUserAgent());
      await page.setExtraHTTPHeaders({
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      });

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.timeout || 30000,
        });
        // Akamai challenge çözüldüğünde gerçek ürün sayfası SSR'lı __NEXT_DATA__ veya
        // JSON-LD ile gelir. Bunlardan biri görünene kadar bekle; her ikisi de yoksa
        // muhtemelen Akamai bloku devam ediyor demektir, content() ile yine de logla.
        await page
          .waitForSelector(
            'script#__NEXT_DATA__, script[type="application/ld+json"], h1[data-test-id="product-name"], [data-test-id="price-current-price"]',
            { timeout: 10000 },
          )
          .catch(() => {
            logger.warn(
              "Hepsiburada Puppeteer: SSR/JSON-LD markers within 10s görülmedi, mevcut HTML ile devam ediliyor",
            );
          });
        pageHtml = await page.content();
        puppeteerFinalUrl = page.url();
        puppeteerContentLength = pageHtml.length;
        puppeteerHasJsonLd = pageHtml.includes("application/ld+json");
        puppeteerHasNextData = pageHtml.includes("__NEXT_DATA__");

        const titleTag = await page.title().catch(() => null);
        const urlTail = url.split("/").filter(Boolean).slice(-1)[0]?.slice(0, 60) || "unknown";
        logger.info(
          `Hepsiburada Puppeteer [${urlTail}]: finalUrl=${puppeteerFinalUrl?.slice(0, 100)} ` +
            `len=${puppeteerContentLength} hasJsonLd=${puppeteerHasJsonLd} hasNextData=${puppeteerHasNextData} ` +
            `title="${(titleTag || "").slice(0, 80)}"`,
        );
      } catch (err) {
        const e = err as HepsiburadaPuppeteerErrorShape;
        lastPuppeteerError = e;
        try {
          puppeteerFinalUrl = page.url();
        } catch {
          puppeteerFinalUrl = null;
        }
        logger.warn(
          `Hepsiburada Puppeteer fail: name=${e?.name || "unknown"} msg="${(e?.message || "no-msg").slice(0, 200)}" ` +
            `finalUrl=${puppeteerFinalUrl || "none"}`,
        );
        throw err;
      }
    } finally {
      await page.close();
    }

    if (pageHtml) {
      const product = parseHepsiburadaHtml(pageHtml);
      if (product && product.price > 0) {
        logger.info(
          `Hepsiburada Puppeteer scraped: ${product.name} - ${product.price} ${product.currency}`,
        );
        await setCachedScrapeResult(url, product);
        return product;
      }
      logger.warn(
        `Hepsiburada Puppeteer parse-fail: name="${product?.name || "none"}" price=${product?.price ?? "null"}`,
      );
    }
  } catch (err) {
    const e = err as HepsiburadaPuppeteerErrorShape;
    if (!lastPuppeteerError) lastPuppeteerError = e;
    logger.warn(`Hepsiburada Puppeteer scrape failed: ${errorMessage(err)}`);
  }

  const htmlErrSummary = lastHtmlStatus
    ? `status=${lastHtmlStatus},len=${lastHtmlLen},server=${lastHtmlServer || "none"},akamaiBlock=${lastHtmlIsAkamaiBlock}`
    : lastHtmlError?.message?.slice(0, 80) || "unknown";
  const puppeteerErrSummary = lastPuppeteerError
    ? `${lastPuppeteerError?.name || "Error"}: ${(lastPuppeteerError?.message || "no-msg").slice(0, 100)}`
    : puppeteerContentLength
      ? `content-len=${puppeteerContentLength},hasJsonLd=${puppeteerHasJsonLd},hasNextData=${puppeteerHasNextData}`
      : "never-ran";

  logger.error(
    `Hepsiburada all-fail summary: url=${url} | HTML: ${htmlErrSummary} | Puppeteer: ${puppeteerErrSummary}`,
  );

  throw new ScraperError(
    `Hepsiburada urun bilgileri cekilemedi (HTML: ${htmlErrSummary}, Puppeteer: ${puppeteerErrSummary})`,
    {
      code: "SCRAPE_ALL_METHODS_FAILED",
      retryable: true,
      softFail: false,
    },
  );
}

// ============================================
// AMAZON TR SCRAPER
// ============================================

// Buybox (satın alma kutusu) fiyat kapsamları — öncelik sırasıyla. Canlıda
// doğrulanan kritik ders (2026-07, HD9650/90 vakası): buybox'sız bir üründe
// sayfadaki İLK .a-price, "benzer ürünler" karuselindeki ALAKASIZ bir ürünün
// fiyatıdır (9.5K'lık fritözde 926 TL yakalandı). Fiyat bu kapsamların DIŞINDAN
// asla alınmaz; buybox boşsa ürün fiyatsız sayılır (yanlış veri > veri yok).
const AMAZON_BUYBOX_PRICE_SELECTORS = [
  "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
  "#corePrice_feature_div .a-price .a-offscreen",
  "#apex_desktop .a-price .a-offscreen",
  "#price_inside_buybox",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  "#sns-base-price",
];

export function parseAmazonTRHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  // Amazon ürün sayfalarında JSON-LD YOKTUR (canlı doğrulandı: 0 blok) —
  // bu yol yalnızca olası gelecekteki eklemeler için korunur.
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
          price: parsePrice(String(offer.price ?? "")),
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

  let htmlPrice = 0;
  for (const selector of AMAZON_BUYBOX_PRICE_SELECTORS) {
    const text = $(selector).first().text().trim();
    if (!text) continue;
    const parsed = parsePrice(text);
    if (parsed > 0) {
      htmlPrice = parsed;
      break;
    }
  }

  // Satıcı: 3P satıcılarda #sellerProfileTriggerId ("TAŞARAVM" canlı vakası);
  // yeni vitrinde #merchantInfoFeature_feature_div "Satıcı X ..." metni taşır.
  const merchantFeatureText = $("#merchantInfoFeature_feature_div").text().trim();
  const merchantFromFeature = merchantFeatureText.match(/Satıcı\s+(\S[^\n]*?)(?:\s{2,}|$)/)?.[1];
  const sellerName =
    $("#sellerProfileTriggerId").text().trim() ||
    merchantFromFeature?.trim() ||
    $("#merchantInfo").text().trim().replace(/\s+/g, " ").slice(0, 80) ||
    undefined;

  const imageUrl =
    $("#landingImage").attr("src") ||
    $("#imgTagWrapperId img").attr("src") ||
    $("meta[property='og:image']").attr("content");

  const availabilityText = $("#availability").text().trim().toLowerCase();
  const inStock =
    !$("#outOfStock").length &&
    !html.toLowerCase().includes("currently unavailable") &&
    !availabilityText.includes("mevcut değil") &&
    !availabilityText.includes("temin edilemiyor");

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

export function parseN11Html(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  // İki fiyat kaynağı ayrı tutulur çünkü anlamları FARKLI (canlı doğrulanan
  // N11 yapısı, 2026-07): JSON-LD artık @type=AggregateOffer taşıyor ve
  // `price` alanı YOK — yalnızca ürünün TÜM satıcılar içindeki en düşüğü olan
  // `lowPrice` var. DOM'daki fiyat ise sayfada gösterilen (magaza=... ile
  // istenen) satıcının kendi fiyatıdır. Kendi-fiyat takibi için DOM önce
  // gelir; lowPrice yalnızca DOM ayrıştırılamadığında son çaredir.
  const holder: {
    data: Partial<ScrapedProduct>;
    aggregateLowPrice: number;
  } = { data: {}, aggregateLowPrice: 0 };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data.price && holder.data.price > 0) return;
    const jsonLd = $(el).html();
    if (!jsonLd) return;
    try {
      const ld = JSON.parse(jsonLd);
      if (ld?.["@type"] !== "Product" && !ld?.offers) return;
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      const directPrice = offer?.price ? parsePrice(String(offer.price)) : 0;
      const lowPrice = offer?.lowPrice ? parsePrice(String(offer.lowPrice)) : 0;
      if (directPrice > 0 || lowPrice > 0 || ld?.name) {
        holder.data = {
          name: ld?.name,
          price: directPrice,
          currency: offer?.priceCurrency || "TRY",
          sellerName: offer?.seller?.name,
          imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image,
          inStock: offer?.availability?.includes("InStock") ?? true,
        };
        holder.aggregateLowPrice = lowPrice;
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
  // .unf-p-sellerInfo eski vitrinden kalma (canlıda artık yok). Satıcı adı
  // yakalanamazsa BU SAYFANIN canonical/og:url'indeki ?magaza= parametresinden
  // okunur — HTML genelinde regex taraması yapılmaz çünkü JSON-LD içindeki
  // AggregateOffer.url BAŞKA satıcının (en ucuzun) magaza parametresini taşır.
  const canonicalUrl =
    $('link[rel="canonical"]').attr("href") || $('meta[property="og:url"]').attr("content") || "";
  const magazaMatch = canonicalUrl.match(/[?&]magaza=([A-Za-z0-9_-]+)/);
  const sellerName =
    $(".unf-p-sellerInfo a").text().trim() ||
    (magazaMatch ? decodeURIComponent(magazaMatch[1]) : undefined) ||
    undefined;
  const inStock = !html.toLowerCase().includes("stokta yok");

  const result: ScrapedProduct = {
    name: parsedFromLd.name || htmlName,
    // Öncelik: sayfada gösterilen satıcı fiyatı (DOM) → JSON-LD düz Offer
    // fiyatı → AggregateOffer.lowPrice (piyasa en düşüğü; yaklaşık değer).
    price: htmlPrice || parsedFromLd.price || holder.aggregateLowPrice || 0,
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
// PTT AVM SCRAPER
// ============================================
//
// PTT AVM pttavm.com — standart ASP.NET tabanlı sayfa. JSON-LD ve OG meta tag'ları
// genelde dolu. Bazı kategorilerde fiyat sadece "data-price" attribute'unda yer alıyor,
// bu yüzden klasik scrapeGeneric'in yanı sıra ek selektörler deniyoruz.

function parsePTTAVMHtml(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);

  const holder: { data: Partial<ScrapedProduct> } = { data: {} };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (holder.data.price && holder.data.price > 0 && holder.data.name) return;
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const candidates: Record<string, unknown>[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") candidates.push(item);
        }
      } else if (parsed && typeof parsed === "object") {
        candidates.push(parsed);
        const graph = (parsed as Record<string, unknown>)["@graph"];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            if (item && typeof item === "object") candidates.push(item as Record<string, unknown>);
          }
        }
      }

      for (const node of candidates) {
        if (node["@type"] !== "Product") continue;
        const offers = node.offers as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined;
        const offer = (Array.isArray(offers) ? offers[0] : offers) as
          | Record<string, unknown>
          | undefined;
        const offerPrice = offer ? parsePrice(String(offer.price ?? "")) : 0;
        if (!holder.data.name && typeof node.name === "string") holder.data.name = node.name;
        if ((!holder.data.price || holder.data.price === 0) && offerPrice > 0) {
          holder.data.price = offerPrice;
        }
        if (!holder.data.currency && typeof offer?.priceCurrency === "string") {
          holder.data.currency = offer.priceCurrency as string;
        }
        if (holder.data.inStock === undefined && typeof offer?.availability === "string") {
          holder.data.inStock = offer.availability.toLowerCase().includes("instock");
        }
        if (!holder.data.imageUrl) {
          const image = node.image;
          if (typeof image === "string") holder.data.imageUrl = image;
          else if (Array.isArray(image) && typeof image[0] === "string")
            holder.data.imageUrl = image[0];
        }
        const seller = offer?.seller as Record<string, unknown> | undefined;
        if (!holder.data.sellerName && typeof seller?.name === "string") {
          holder.data.sellerName = seller.name as string;
        }
      }
    } catch {
      // skip invalid JSON-LD
    }
  });

  // Meta tag fallback'leri
  const ogTitle = $("meta[property='og:title']").attr("content") || "";
  const ogImage = $("meta[property='og:image']").attr("content") || undefined;
  const ogPriceRaw =
    $("meta[property='product:price:amount']").attr("content") ||
    $("meta[property='og:price:amount']").attr("content") ||
    $("meta[itemprop='price']").attr("content") ||
    "";
  const ogPrice = ogPriceRaw ? parsePrice(ogPriceRaw) : 0;

  const htmlName =
    $("h1.product-name").first().text().trim() ||
    $("h1.product-title").first().text().trim() ||
    $("[class*='ProductName']").first().text().trim() ||
    $("h1").first().text().trim();

  const htmlPriceText =
    $("[itemprop='price']").first().attr("content") ||
    $(".product-price-new").first().text().trim() ||
    $(".price-current, .currentPrice, .productPrice").first().text().trim() ||
    $("[class*='Price__current'], [class*='product-price']").first().text().trim() ||
    "";
  const htmlPrice = parsePrice(htmlPriceText);

  // PTT AVM bazen fiyatı sadece data-price attribute'unda tutar
  const dataPriceAttr =
    $("[data-price]").first().attr("data-price") ||
    $("[data-product-price]").first().attr("data-product-price") ||
    "";
  const dataPrice = dataPriceAttr ? parsePrice(dataPriceAttr) : 0;

  const finalName =
    holder.data.name ||
    htmlName ||
    ogTitle.replace(/\s*[-–|]\s*PTT.*$/i, "").trim() ||
    "PTT AVM ürünü";
  const finalPrice = [holder.data.price, htmlPrice, dataPrice, ogPrice].find(
    (v): v is number => typeof v === "number" && v > 0,
  );

  if (!finalName && !finalPrice) return null;

  const lower = html.toLowerCase();
  const outOfStock =
    lower.includes("stokta yok") || lower.includes("tükendi") || lower.includes("out-of-stock");

  return {
    name: finalName,
    price: finalPrice ?? 0,
    currency: holder.data.currency || "TRY",
    inStock: holder.data.inStock ?? !outOfStock,
    sellerName: holder.data.sellerName,
    imageUrl: holder.data.imageUrl || ogImage,
  };
}

export async function scrapePTTAVM(
  url: string,
  config: ScraperConfig = {},
): Promise<ScrapedProduct> {
  logger.info(`Scraping PTT AVM: ${url}`);
  return scrapeWithFallbackCached(url, config, parsePTTAVMHtml, "PTT AVM");
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
            price: parsePrice(String(offers?.price ?? "")),
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
    case "DECATHLON": // legacy kayıtlar için; yeni Decathlon eklemeleri kapalı
    case "PAZARAMA":
      return scrapeGeneric;
    case "MEDIAMARKT":
      return scrapeMediaMarkt;
    case "PTTAVM":
      return scrapePTTAVM;
    default:
      // Fallback to generic for unknown marketplaces
      logger.warn(`No specific scraper for ${marketplace}, using generic`);
      return scrapeGeneric;
  }
}
