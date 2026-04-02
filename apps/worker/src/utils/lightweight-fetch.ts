import * as cheerio from "cheerio";
import { logger } from "./logger";

// Domain bazlı rate limiting — her domain için son istek zamanını tut
const lastFetchByDomain = new Map<string, number>();
const MIN_FETCH_INTERVAL_MS = 1000; // Aynı domain'e en az 1 saniye arayla

async function waitForDomainSlot(domain: string): Promise<void> {
  const lastFetch = lastFetchByDomain.get(domain) || 0;
  const elapsed = Date.now() - lastFetch;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_FETCH_INTERVAL_MS - elapsed));
  }
  lastFetchByDomain.set(domain, Date.now());
}

// Server-rendered siteleri (Cheerio ile fiyat çekilebilir)
const FETCHABLE_DOMAINS = [
  "cimri.com",
  "akakce.com",
  "epey.com",
  "n11.com",
  "amazon.com.tr",
  "mediamarkt.com.tr",
  "teknosa.com",
  "vatanbilgisayar.com",
  "decathlon.com.tr",
  "kitapyurdu.com",
];

// SPA siteleri (Cheerio ile okunamaz, Serper fiyatına güven)
const SPA_DOMAINS = ["trendyol.com", "hepsiburada.com"];

interface FetchPriceResult {
  price: number | null;
  source: "json-ld" | "meta-tag" | "serper-cache" | "fetch-failed";
  fetchedAt: Date;
}

/**
 * Rakip URL'sindeki gerçek fiyatı doğrula.
 * Server-rendered siteler için JSON-LD/meta tag parse eder.
 * SPA siteler için Serper fiyatını kabul eder.
 * Timeout: 5 saniye. Hata durumunda null döner.
 */
export async function verifyCompetitorPrice(
  competitorUrl: string,
  serperPrice: number,
): Promise<FetchPriceResult> {
  const domain = extractDomain(competitorUrl);

  // SPA siteleri → Serper fiyatına güven
  if (SPA_DOMAINS.some((d) => domain.includes(d))) {
    return { price: serperPrice, source: "serper-cache", fetchedAt: new Date() };
  }

  // Fetchable olmayan siteler → Serper fiyatına güven
  if (!FETCHABLE_DOMAINS.some((d) => domain.includes(d))) {
    return { price: serperPrice, source: "serper-cache", fetchedAt: new Date() };
  }

  // Server-rendered site → doğrudan fetch + parse
  try {
    await waitForDomainSlot(domain);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(competitorUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { price: serperPrice, source: "fetch-failed", fetchedAt: new Date() };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. JSON-LD'den fiyat çek
    const jsonLdPrice = extractPriceFromJsonLd($);
    if (jsonLdPrice && jsonLdPrice > 0) {
      logger.info(
        { url: competitorUrl.slice(0, 60), price: jsonLdPrice, source: "json-ld" },
        "Price verified",
      );
      return { price: jsonLdPrice, source: "json-ld", fetchedAt: new Date() };
    }

    // 2. Meta tag'den fiyat çek
    const metaPrice = extractPriceFromMeta($);
    if (metaPrice && metaPrice > 0) {
      logger.info(
        { url: competitorUrl.slice(0, 60), price: metaPrice, source: "meta-tag" },
        "Price verified",
      );
      return { price: metaPrice, source: "meta-tag", fetchedAt: new Date() };
    }

    // Fiyat bulunamadı → Serper'a güven
    return { price: serperPrice, source: "fetch-failed", fetchedAt: new Date() };
  } catch {
    // Timeout veya network hatası → Serper'a güven
    return { price: serperPrice, source: "fetch-failed", fetchedAt: new Date() };
  }
}

function extractPriceFromJsonLd($: cheerio.CheerioAPI): number | null {
  try {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      const text = $(scripts[i]).html();
      if (!text) continue;
      const data = JSON.parse(text);

      // Tek ürün
      if (data["@type"] === "Product" && data.offers) {
        const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
        const price = parseFloat(offer.price || offer.lowPrice || "0");
        if (price > 0) return price;
      }

      // @graph array
      if (data["@graph"]) {
        for (const item of data["@graph"]) {
          if (item["@type"] === "Product" && item.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            const price = parseFloat(offer.price || offer.lowPrice || "0");
            if (price > 0) return price;
          }
        }
      }
    }
  } catch {
    // JSON parse hatası — devam et
  }
  return null;
}

function extractPriceFromMeta($: cheerio.CheerioAPI): number | null {
  // OpenGraph product price
  const ogPrice =
    $('meta[property="product:price:amount"]').attr("content") ||
    $('meta[property="og:price:amount"]').attr("content");
  if (ogPrice) {
    const price = parseFloat(ogPrice.replace(",", "."));
    if (price > 0) return price;
  }
  return null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
