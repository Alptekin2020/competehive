import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, isScraperBackedRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { verifyProductMatch, MatchResult } from "../matcher";
import { Marketplace } from "@prisma/client";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";
import { recoverPriceLightweight } from "../utils/recover-price";
import { isPackagingListing, withinPriceBand } from "../utils/competitor-quality";
import { alertQueue } from "./processor";

interface OnboardJobData {
  productId: string;
  title: string;
  url: string;
}

/**
 * Domain → Prisma Marketplace enum eşlemesi.
 */
function retailerToMarketplace(retailerName: string): Marketplace {
  const map: Record<string, Marketplace> = {
    Trendyol: "TRENDYOL",
    Hepsiburada: "HEPSIBURADA",
    "Amazon TR": "AMAZON_TR",
    N11: "N11",
    MediaMarkt: "MEDIAMARKT",
    Teknosa: "TEKNOSA",
    Vatan: "VATAN",
    Decathlon: "DECATHLON",
    "PTT AVM": "PTTAVM",
    Çiçeksepeti: "CICEKSEPETI",
    Akakçe: "AKAKCE",
    Cimri: "CIMRI",
    Epey: "EPEY",
    Boyner: "BOYNER",
    Watsons: "WATSONS",
    Kitapyurdu: "KITAPYURDU",
    Sephora: "SEPHORA",
    Koçtaş: "KOCTAS",
    İtopya: "ITOPYA",
    Gratis: "GRATIS",
  };
  return map[retailerName] ?? "CUSTOM";
}

/**
 * TrackedProduct.metadata JSON alanından AI tarafından üretilmiş searchKeywords'u
 * güvenli şekilde çıkar. Geçersiz/eksikse boş dizi döner.
 */
function extractSearchKeywords(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as { searchKeywords?: unknown };
  if (!Array.isArray(meta.searchKeywords)) return [];
  return meta.searchKeywords.filter(
    (k): k is string => typeof k === "string" && k.trim().length > 0,
  );
}

/**
 * Birden fazla keyword ile Serper araması yap, URL bazında dedup uygula.
 */
async function searchWithKeywords(keywords: string[]): Promise<SerperShoppingResult[]> {
  const seenUrls = new Set<string>();
  const allResults: SerperShoppingResult[] = [];

  const primary = keywords[0];
  console.log(`🔎 Primary search: "${primary}"`);
  try {
    const primaryResults = await searchProduct(primary);
    for (const r of primaryResults) {
      const normalizedUrl = (r.link || "").replace(/\/$/, "").toLowerCase();
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        allResults.push(r);
      }
    }
  } catch (err) {
    console.error(`Primary search hatası ("${primary}"):`, err);
  }

  if (allResults.length < 5 && keywords.length > 1) {
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      const fallback = keywords[i];
      console.log(`🔎 Fallback search [${i}]: "${fallback}"`);
      try {
        const fallbackResults = await searchProduct(fallback);
        for (const r of fallbackResults) {
          const normalizedUrl = (r.link || "").replace(/\/$/, "").toLowerCase();
          if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            allResults.push(r);
          }
        }
      } catch (err) {
        console.error(`Fallback search hatası ("${fallback}"):`, err);
      }
      if (allResults.length >= 15) break;
    }
  }

  console.log(`📦 Toplam unique Serper sonucu: ${allResults.length}`);
  return allResults;
}

const RAW_TITLE_MAX_WORDS = 6;
function truncateRawTitleForSearch(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length <= RAW_TITLE_MAX_WORDS + 1) return title.trim();
  return words.slice(0, RAW_TITLE_MAX_WORDS).join(" ");
}

function isInPriceBand(price: number, sourcePrice: number | null): boolean {
  if (!sourcePrice || sourcePrice <= 0) return true;
  return withinPriceBand(sourcePrice, price);
}

export async function processCompetitorJob(job: Job<OnboardJobData>) {
  const { productId, title, url } = job.data;
  console.log(`🔍 Competitor arama başlıyor: ${title} (${productId})`);

  try {
    await updateTrackedProductRefresh(productId, { refreshStatus: "processing" });
  } catch {
    // Product may not exist yet, continue
  }

  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
  });

  if (!product) {
    console.warn(`⚠️ Ürün bulunamadı: ${productId}`);
    return { found: 0 };
  }

  try {
    const searchKeywords = extractSearchKeywords(product.metadata);
    const queries = searchKeywords.length > 0 ? searchKeywords : [truncateRawTitleForSearch(title)];
    console.log(
      `🧠 ${
        searchKeywords.length > 0 ? "Metadata keywords kullanılıyor" : "Fallback: raw title"
      }: ${JSON.stringify(queries)}`,
    );

    const results = await searchWithKeywords(queries);

    if (!results || results.length === 0) {
      console.log(`⚠️ Sonuç bulunamadı: ${title}`);
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "completed",
        refreshCompletedAt: new Date(),
        refreshError: null,
      });
      return { found: 0 };
    }

    const now = new Date();
    let savedCount = 0;
    let priceFilteredCount = 0;
    let aiRejectedCount = 0;
    let packagingFilteredCount = 0;
    let priceRecoveredCount = 0;
    let priceUnrecoverableCount = 0;

    const sourcePrice = product.currentPrice ? Number(product.currentPrice) : null;

    for (const result of results) {
      if (result.link === url) continue;

      // Deterministik ambalaj/koli filtresi — AI çağrısından önce, maliyetsiz.
      if (isPackagingListing(result.title, product.productName)) {
        packagingFilteredCount++;
        console.log(`📦 Ambalaj/koli sonucu elendi: ${result.title.slice(0, 60)}`);
        continue;
      }

      const retailer = extractRetailer(result.link);
      const isScraperBacked = isScraperBackedRetailer(retailer.name);

      let price = parsePrice(result.price);

      // ============================================
      // Audit P0-1: Fiyat boş geldiğinde recovery dene
      // ============================================
      // Eski davranış: fiyat null → sessizce drop. Hepsiburada en sık kurbandı çünkü
      // Akamai Google'a price feed vermiyor. Yeni davranış: scraper destekli retailer'larda
      // önce AI title match'i (ucuz), sonra fiyat kurtarma (HTTP only — Puppeteer DEĞİL).
      let priceRecovered = false;
      // Kurtarma yolunda da eşleşme skoru SAKLANMALI — aksi halde rakip kaydı
      // matchScore=null ile yaratılıp UI'da "güvenilir" muamelesi görüyor.
      let recoveryMatch: MatchResult | null = null;
      const needsRecovery = (!price || price <= 0) && isScraperBacked;
      if (needsRecovery) {
        // AI matcher'ı price olmadan da çalıştırabiliriz; price filtresi recovery sonrası
        // uygulanır. AI title-only match gate'i: skor >= MIN_MATCH_SCORE.
        let preMatch: MatchResult;
        try {
          preMatch = await verifyProductMatch(
            { title, price: sourcePrice ?? undefined, marketplace: product.marketplace },
            { title: result.title, url: result.link, marketplace: retailer.name },
          );
        } catch {
          continue;
        }

        if (!preMatch.isMatch) {
          aiRejectedCount++;
          console.log(
            `❌ AI reddetti (pre-match no-price, skor: ${preMatch.score}): ${result.title.slice(0, 50)}`,
          );
          continue;
        }

        // Title eşleşti → lightweight HTTP fallback ile fiyat çek
        recoveryMatch = preMatch;
        try {
          const recovered = await recoverPriceLightweight(result.link);
          if (recovered.price && recovered.price > 0) {
            price = recovered.price;
            priceRecovered = true;
            priceRecoveredCount++;
            console.log(
              `🛟 Fiyat kurtarıldı (${recovered.source}, ${retailer.name}): ${price} ₺ — ${result.title.slice(0, 50)}`,
            );
          } else {
            priceUnrecoverableCount++;
            console.log(
              `⚠️ Fiyat kurtarılamadı (${recovered.source}, ${retailer.name}): ${result.title.slice(0, 50)} — drop`,
            );
            continue;
          }
        } catch (err) {
          priceUnrecoverableCount++;
          console.error(`Recovery hatası (${result.link}):`, err);
          continue;
        }
      }

      if (!price || price <= 0) {
        // Hâlâ fiyat yok → drop. Burayı sayaca eklemiyoruz; eskiden tüm flow buydu.
        continue;
      }

      // Price band filter
      if (!isInPriceBand(price, sourcePrice)) {
        priceFilteredCount++;
        console.log(
          `⏭️  Fiyat bandı dışı (${price.toFixed(2)} ₺, kaynak ${sourcePrice?.toFixed(2)} ₺): ${result.title.slice(0, 60)}`,
        );
        continue;
      }

      // AI matcher — recovery yaptıysak yeniden çalıştırma (zaten title-only match
      // yapıldı; preMatch sonucu matchResult olarak saklanır). Recovery
      // YAPMADIYSAK normal AI match akışı.
      let matchResult: MatchResult | null = recoveryMatch;
      if (!priceRecovered) {
        try {
          matchResult = await verifyProductMatch(
            { title, price: sourcePrice ?? undefined, marketplace: product.marketplace },
            { title: result.title, url: result.link, price, marketplace: retailer.name },
          );
        } catch {
          continue;
        }

        if (!matchResult.isMatch) {
          aiRejectedCount++;
          console.log(
            `❌ AI reddetti (skor: ${matchResult.score}): ${result.title.slice(0, 50)} — ${matchResult.reason}`,
          );
          continue;
        }
      }

      const marketplace = retailerToMarketplace(retailer.name);

      try {
        const competitor = await prisma.competitor.upsert({
          where: {
            trackedProductId_competitorUrl: {
              trackedProductId: productId,
              competitorUrl: result.link,
            },
          },
          update: {
            competitorName: result.title,
            currentPrice: price,
            marketplace,
            lastScrapedAt: now,
            matchScore: matchResult?.score,
            matchReason: matchResult?.reason,
            matchAttributes: matchResult?.attributes,
          },
          create: {
            trackedProductId: productId,
            competitorUrl: result.link,
            competitorName: result.title,
            marketplace,
            currentPrice: price,
            lastScrapedAt: now,
            matchScore: matchResult?.score,
            matchReason: matchResult?.reason,
            matchAttributes: matchResult?.attributes,
          },
        });

        await prisma.competitorPrice.create({
          data: {
            competitorId: competitor.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });

        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price,
            currency: "TRY",
            inStock: true,
            sellerName: retailer.name,
            scrapedAt: now,
          },
        });

        savedCount++;
      } catch (err) {
        console.error(`Competitor kaydetme hatası (${result.link}):`, err);
      }
    }

    if (sourcePrice && sourcePrice > 0) {
      try {
        const ownRetailer = extractRetailer(product.productUrl);
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: sourcePrice,
            currency: product.currency,
            inStock: product.status !== "OUT_OF_STOCK",
            sellerName: ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm",
            scrapedAt: now,
          },
        });
      } catch (err) {
        console.error(`Kendi fiyatı kaydetme hatası:`, err);
      }
    }

    // COMPETITOR_CHEAPER alarmlarını rakip fiyatları güncellendiğinde de tetikle.
    if (savedCount > 0 && sourcePrice && sourcePrice > 0) {
      await alertQueue.add("check-alerts", {
        productId,
        eventTypes: ["competitor-change"],
        currentPrice: sourcePrice,
        previousPrice: null,
        priceChange: null,
        priceChangePct: null,
        inStock: product.status !== "OUT_OF_STOCK",
        previousInStock: null,
      });
    }

    await updateTrackedProductRefresh(productId, {
      refreshStatus: "completed",
      refreshCompletedAt: new Date(),
      refreshError: null,
    });

    console.log(
      `✅ ${productId}: ${savedCount} competitor kaydedildi ` +
        `(price filtered: ${priceFilteredCount}, AI rejected: ${aiRejectedCount}, ` +
        `packaging filtered: ${packagingFilteredCount}, ` +
        `recovered: ${priceRecoveredCount}, unrecoverable: ${priceUnrecoverableCount})`,
    );
    return {
      found: savedCount,
      priceFiltered: priceFilteredCount,
      aiRejected: aiRejectedCount,
      packagingFiltered: packagingFilteredCount,
      priceRecovered: priceRecoveredCount,
      priceUnrecoverable: priceUnrecoverableCount,
    };
  } catch (error) {
    try {
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "failed",
        refreshCompletedAt: new Date(),
        refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
      });
    } catch (statusUpdateError) {
      console.error("Failed to update refresh status:", statusUpdateError);
    }
    throw error;
  }
}
