import { Job } from "bullmq";

import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { getScraper } from "../scrapers";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";

interface RefreshUrlJobData {
  productUrl: string;
}

// host + pathname based URL key so tracking params and casing don't break matching.
function urlMatchKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

/**
 * TrackedProduct.metadata JSON alanından AI-generated searchKeywords'u güvenli şekilde çıkar.
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
 * Multi-keyword Serper search with URL dedup. competitor-processor.ts ile aynı pattern.
 */
async function searchWithKeywords(keywords: string[]): Promise<SerperShoppingResult[]> {
  const seenUrls = new Set<string>();
  const allResults: SerperShoppingResult[] = [];

  const primary = keywords[0];
  console.log(`🔎 URL-refresh primary search: "${primary}"`);
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
    console.error(`URL-refresh primary search hatası ("${primary}"):`, err);
  }

  if (allResults.length < 5 && keywords.length > 1) {
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      const fallback = keywords[i];
      console.log(`🔎 URL-refresh fallback [${i}]: "${fallback}"`);
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
        console.error(`URL-refresh fallback hatası ("${fallback}"):`, err);
      }
      if (allResults.length >= 15) break;
    }
  }

  return allResults;
}

/**
 * URL bazlı dedup edilmiş refresh işleyicisi.
 * Aynı productUrl'i takip eden tüm sibling TrackedProduct'ları tek source-scrape +
 * tek Serper search ile günceller.
 *
 * Existing semantic korunuyor: sadece *bilinen* competitor URL'lerinin fiyatı güncellenir,
 * yeni competitor eklenmez (onboarding işi).
 */
export async function processRefreshUrlJob(job: Job<RefreshUrlJobData>) {
  const { productUrl } = job.data;

  // 1. Bu URL'i takip eden tüm aktif TrackedProduct'ları bul
  const siblings = await prisma.trackedProduct.findMany({
    where: {
      productUrl,
      status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
    },
    include: { competitors: true },
  });

  if (siblings.length === 0) {
    console.log(`⚠️ URL refresh: sibling bulunamadı: ${productUrl}`);
    return { processedSiblings: 0 };
  }

  console.log(`🔄 URL refresh: ${productUrl} (${siblings.length} sibling)`);

  const siblingIds = siblings.map((s) => s.id);
  const now = new Date();

  // 2. Tüm siblingsleri "processing" olarak işaretle
  await Promise.all(
    siblingIds.map((id) =>
      updateTrackedProductRefresh(id, { refreshStatus: "processing" }).catch(() => {
        // Yumuşak hata — devam et
      }),
    ),
  );

  // Primary sibling — metadata + scraper seçimi için kullanılacak
  const primary = siblings[0];

  // Source scrape başarısızsa Serper sonuçlarında kendi URL'imizi arayıp fiyatı kurtaracağız.
  let sourcePriceResolved = false;

  try {
    // 3. Source URL'i BİR KEZ scrape et
    try {
      const scraper = getScraper(primary.marketplace);
      const sourceData = await scraper(productUrl);

      if (sourceData?.price && sourceData.price > 0) {
        sourcePriceResolved = true;
        const updateData: {
          currentPrice: number;
          lastScrapedAt: Date;
          productName?: string;
          productImage?: string;
          sellerName?: string;
          status?: "ACTIVE" | "OUT_OF_STOCK";
        } = {
          currentPrice: sourceData.price,
          lastScrapedAt: now,
          status: sourceData.inStock ? "ACTIVE" : "OUT_OF_STOCK",
        };

        if (typeof sourceData.name === "string" && sourceData.name.trim().length > 3) {
          updateData.productName = sourceData.name.trim();
        }
        if (typeof sourceData.imageUrl === "string" && sourceData.imageUrl.trim().length > 0) {
          updateData.productImage = sourceData.imageUrl.trim();
        }
        if (typeof sourceData.sellerName === "string" && sourceData.sellerName.trim().length > 0) {
          updateData.sellerName = sourceData.sellerName.trim();
        }

        // 4. TÜM siblings'i tek update ile güncelle
        await prisma.trackedProduct.updateMany({
          where: { id: { in: siblingIds } },
          data: updateData,
        });

        // Her sibling için PriceHistory snapshot
        const ownRetailer = extractRetailer(productUrl);
        const sellerName =
          (typeof sourceData.sellerName === "string" && sourceData.sellerName.trim().length > 0
            ? sourceData.sellerName.trim()
            : null) || (ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm");

        await prisma.priceHistory.createMany({
          data: siblings.map((s) => ({
            trackedProductId: s.id,
            price: sourceData.price,
            currency: sourceData.currency || s.currency,
            inStock: sourceData.inStock,
            sellerName,
            scrapedAt: now,
          })),
        });

        console.log(
          `✅ Source scrape başarılı: ${productUrl} — ${sourceData.price} (${siblings.length} sibling güncellendi)`,
        );
      } else {
        console.warn(`⚠️ Source scrape price bulunamadı: ${productUrl}`);
      }
    } catch (sourceError) {
      console.error(`⚠️ Source scrape hatası: ${productUrl}`, sourceError);
      // Source scrape failure → siblings için fallback PriceHistory yaz (mevcut fiyatla)
      const ownRetailer = extractRetailer(productUrl);
      const fallbackSellerName = ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm";
      const fallbackHistory = siblings
        .filter((s) => s.currentPrice && Number(s.currentPrice) > 0)
        .map((s) => ({
          trackedProductId: s.id,
          price: Number(s.currentPrice),
          currency: s.currency,
          inStock: s.status !== "OUT_OF_STOCK",
          sellerName: fallbackSellerName,
          scrapedAt: now,
        }));

      if (fallbackHistory.length > 0) {
        try {
          await prisma.priceHistory.createMany({ data: fallbackHistory });
        } catch {
          // ignore — bir snapshot kaybı kritik değil
        }
      }
    }

    // 5. Tüm siblings'in bilinen competitor URL'lerini topla (URL → [competitor records])
    const competitorByUrl = new Map<
      string,
      Array<{
        id: string;
        trackedProductId: string;
        competitorUrl: string;
        competitorName: string | null;
      }>
    >();

    for (const sibling of siblings) {
      for (const c of sibling.competitors) {
        const list = competitorByUrl.get(c.competitorUrl) ?? [];
        list.push({
          id: c.id,
          trackedProductId: sibling.id,
          competitorUrl: c.competitorUrl,
          competitorName: c.competitorName,
        });
        competitorByUrl.set(c.competitorUrl, list);
      }
    }

    if (competitorByUrl.size === 0) {
      console.log(`ℹ️ URL refresh: bilinen competitor yok, Serper atlanıyor`);
      await Promise.all(
        siblingIds.map((id) =>
          updateTrackedProductRefresh(id, {
            refreshStatus: "completed",
            refreshCompletedAt: now,
            refreshError: null,
          }),
        ),
      );
      return {
        processedSiblings: siblings.length,
        knownCompetitorUrls: 0,
        updatedCount: 0,
      };
    }

    // 6. Serper search BİR KEZ
    const searchKeywords = extractSearchKeywords(primary.metadata);
    const queries =
      searchKeywords.length > 0 ? searchKeywords : [primary.productName].filter(Boolean);

    if (queries.length === 0) {
      console.warn(`⚠️ URL refresh: keyword yok, Serper atlanıyor: ${productUrl}`);
      await Promise.all(
        siblingIds.map((id) =>
          updateTrackedProductRefresh(id, {
            refreshStatus: "completed",
            refreshCompletedAt: now,
            refreshError: null,
          }),
        ),
      );
      return { processedSiblings: siblings.length, updatedCount: 0 };
    }

    console.log(
      `🧠 ${
        searchKeywords.length > 0 ? "Metadata keywords" : "Fallback: productName"
      }: ${JSON.stringify(queries)}`,
    );

    const serperResults = await searchWithKeywords(queries);
    console.log(`📦 URL refresh: ${serperResults.length} unique Serper sonucu`);

    // 6.5. Source scrape başarısızsa Serper sonuçlarında kendi URL'imizi ara
    if (!sourcePriceResolved) {
      const ownKey = urlMatchKey(productUrl);
      for (const result of serperResults) {
        if (urlMatchKey(result.link) !== ownKey) continue;
        const serperOwnPrice = parsePrice(result.price);
        if (!serperOwnPrice || serperOwnPrice <= 0) continue;

        const ownRetailer = extractRetailer(productUrl);
        const ownSellerName = ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm";

        try {
          await prisma.trackedProduct.updateMany({
            where: { id: { in: siblingIds } },
            data: {
              currentPrice: serperOwnPrice,
              lastScrapedAt: now,
            },
          });

          await prisma.priceHistory.createMany({
            data: siblings.map((s) => ({
              trackedProductId: s.id,
              price: serperOwnPrice,
              currency: s.currency,
              inStock: true,
              sellerName: ownSellerName,
              scrapedAt: now,
            })),
          });

          sourcePriceResolved = true;
          console.log(
            `✅ Kendi fiyat Serper'dan kurtarıldı (URL refresh): ${productUrl} — ${serperOwnPrice}`,
          );
        } catch (err) {
          console.error(`Serper own-price kaydetme hatası (URL refresh):`, err);
        }
        break;
      }
    }

    // 7. Her bilinen competitor URL'i için Serper'da match varsa fiyatı güncelle
    let updatedCount = 0;
    const competitorPriceSnapshots: Array<{
      competitorId: string;
      price: number;
      currency: string;
      inStock: boolean;
      scrapedAt: Date;
    }> = [];
    const priceHistorySnapshots: Array<{
      trackedProductId: string;
      price: number;
      currency: string;
      inStock: boolean;
      sellerName: string;
      scrapedAt: Date;
    }> = [];

    for (const result of serperResults) {
      const matchingCompetitors = competitorByUrl.get(result.link);
      if (!matchingCompetitors || matchingCompetitors.length === 0) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      const retailer = extractRetailer(result.link);
      const matchingIds = matchingCompetitors.map((c) => c.id);

      try {
        // Aynı URL'i paylaşan tüm competitor kayıtlarını tek query ile güncelle.
        // result.title boşsa undefined → Prisma alanı atlar → mevcut competitorName korunur.
        await prisma.competitor.updateMany({
          where: { id: { in: matchingIds } },
          data: {
            currentPrice: price,
            competitorName: result.title || undefined,
            lastScrapedAt: now,
          },
        });

        for (const c of matchingCompetitors) {
          competitorPriceSnapshots.push({
            competitorId: c.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          });
          priceHistorySnapshots.push({
            trackedProductId: c.trackedProductId,
            price,
            currency: "TRY",
            inStock: true,
            sellerName: retailer.name,
            scrapedAt: now,
          });
          updatedCount++;
        }
      } catch (err) {
        console.error(`Bulk competitor update hatası (${result.link}):`, err);
      }
    }

    // Snapshotları toplu yaz — N×M tek-tek insert yerine 2 tek createMany.
    if (competitorPriceSnapshots.length > 0) {
      try {
        await prisma.competitorPrice.createMany({ data: competitorPriceSnapshots });
      } catch (err) {
        console.error("Bulk competitorPrice insert hatası:", err);
      }
    }
    if (priceHistorySnapshots.length > 0) {
      try {
        await prisma.priceHistory.createMany({ data: priceHistorySnapshots });
      } catch (err) {
        console.error("Bulk priceHistory insert hatası:", err);
      }
    }

    // 8. Tüm siblings "completed"
    await Promise.all(
      siblingIds.map((id) =>
        updateTrackedProductRefresh(id, {
          refreshStatus: "completed",
          refreshCompletedAt: now,
          refreshError: null,
        }),
      ),
    );

    console.log(
      `✅ URL refresh tamamlandı: ${productUrl} — ${siblings.length} sibling, ${competitorByUrl.size} unique competitor URL, ${updatedCount} update`,
    );

    return {
      processedSiblings: siblings.length,
      knownCompetitorUrls: competitorByUrl.size,
      updatedCount,
    };
  } catch (error) {
    // Tüm siblings "failed"
    await Promise.all(
      siblingIds.map((id) =>
        updateTrackedProductRefresh(id, {
          refreshStatus: "failed",
          refreshCompletedAt: now,
          refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
        }).catch(() => {
          // ignore
        }),
      ),
    );
    throw error;
  }
}
