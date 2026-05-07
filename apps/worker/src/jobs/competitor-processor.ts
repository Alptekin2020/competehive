import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { verifyProductMatch, MatchResult } from "../matcher";
import { Marketplace } from "@prisma/client";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";

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
 * Primary keyword'den yeterince sonuç gelirse fallback keyword'leri çağırma —
 * Serper maliyeti tasarrufu için early exit var.
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

  // Primary'den 5'ten az sonuç geldiyse fallback keyword'leri dene (max 2 ek call)
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

// Price pre-filter sabitleri — matcher.ts'in "%300 fiyat farkı" kuralı ile uyumlu
const PRICE_BAND_MIN_RATIO = 0.3; // kaynak fiyatın %30'undan az → reddet
const PRICE_BAND_MAX_RATIO = 3.0; // kaynak fiyatın %300'ünden fazla → reddet

export async function processCompetitorJob(job: Job<OnboardJobData>) {
  const { productId, title, url } = job.data;
  console.log(`🔍 Competitor arama başlıyor: ${title} (${productId})`);

  // Mark as processing
  try {
    await updateTrackedProductRefresh(productId, { refreshStatus: "processing" });
  } catch {
    // Product may not exist yet, continue
  }

  // Ürünün var olduğunu doğrula
  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
  });

  if (!product) {
    console.warn(`⚠️ Ürün bulunamadı: ${productId}`);
    return { found: 0 };
  }

  try {
    // 1. Metadata'dan AI tarafından üretilmiş searchKeywords'u çıkar
    const searchKeywords = extractSearchKeywords(product.metadata);
    const queries = searchKeywords.length > 0 ? searchKeywords : [title];
    console.log(
      `🧠 ${
        searchKeywords.length > 0 ? "Metadata keywords kullanılıyor" : "Fallback: raw title"
      }: ${JSON.stringify(queries)}`,
    );

    // 2. Serper ile çoklu keyword araması yap (dedup ile)
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

    // Kaynak fiyat — pre-filter için kullanılacak
    const sourcePrice = product.currentPrice ? Number(product.currentPrice) : null;

    for (const result of results) {
      // Kendi URL'imizi atla
      if (result.link === url) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      // 3. PRICE PRE-FILTER — bandı dışındakileri AI'a bile gönderme
      if (sourcePrice && sourcePrice > 0) {
        const minAllowed = sourcePrice * PRICE_BAND_MIN_RATIO;
        const maxAllowed = sourcePrice * PRICE_BAND_MAX_RATIO;
        if (price < minAllowed || price > maxAllowed) {
          priceFilteredCount++;
          console.log(
            `⏭️  Fiyat bandı dışı (${price.toFixed(2)} ₺, kaynak ${sourcePrice.toFixed(
              2,
            )} ₺): ${result.title.slice(0, 60)}`,
          );
          continue;
        }
      }

      const retailer = extractRetailer(result.link);

      // 4. AI ile eşleştirme doğrula
      let matchResult: MatchResult;
      try {
        matchResult = await verifyProductMatch(
          {
            title,
            price: sourcePrice ?? undefined,
            marketplace: product.marketplace,
          },
          {
            title: result.title,
            url: result.link,
            price,
            marketplace: retailer.name,
          },
        );
      } catch {
        // AI hatası → bu sonucu atla, diğerlerine devam et
        continue;
      }

      if (!matchResult.isMatch) {
        aiRejectedCount++;
        console.log(
          `❌ AI reddetti (skor: ${matchResult.score}): ${result.title.slice(0, 50)} — ${
            matchResult.reason
          }`,
        );
        continue;
      }

      const marketplace = retailerToMarketplace(retailer.name);

      // 5. Competitor kaydını upsert et
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
            matchScore: matchResult.score,
            matchReason: matchResult.reason,
            matchAttributes: matchResult.attributes,
          },
          create: {
            trackedProductId: productId,
            competitorUrl: result.link,
            competitorName: result.title,
            marketplace,
            currentPrice: price,
            lastScrapedAt: now,
            matchScore: matchResult.score,
            matchReason: matchResult.reason,
            matchAttributes: matchResult.attributes,
          },
        });

        // CompetitorPrice snapshot
        await prisma.competitorPrice.create({
          data: {
            competitorId: competitor.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });

        // PriceHistory snapshot (detail sayfası grafiği için)
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
        // Tek bir competitor hatasında job'ı öldürme — devam et
      }
    }

    // Kullanıcının kendi ürün fiyatını da PriceHistory'ye kaydet
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

    // Mark as completed
    await updateTrackedProductRefresh(productId, {
      refreshStatus: "completed",
      refreshCompletedAt: new Date(),
      refreshError: null,
    });

    console.log(
      `✅ ${productId}: ${savedCount} competitor kaydedildi (price filtered: ${priceFilteredCount}, AI rejected: ${aiRejectedCount})`,
    );
    return { found: savedCount };
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
    throw error; // re-throw — BullMQ job failed olarak işaretlesin
  }
}
