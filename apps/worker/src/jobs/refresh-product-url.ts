import { Job } from "bullmq";

import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { getScraper } from "../scrapers";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";

interface RefreshUrlJobData {
  productUrl: string;
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

  try {
    // 3. Source URL'i BİR KEZ scrape et
    try {
      const scraper = getScraper(primary.marketplace);
      const sourceData = await scraper(productUrl);

      if (sourceData?.price && sourceData.price > 0) {
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
      for (const sibling of siblings) {
        if (sibling.currentPrice && Number(sibling.currentPrice) > 0) {
          try {
            const ownRetailer = extractRetailer(productUrl);
            await prisma.priceHistory.create({
              data: {
                trackedProductId: sibling.id,
                price: Number(sibling.currentPrice),
                currency: sibling.currency,
                inStock: sibling.status !== "OUT_OF_STOCK",
                sellerName: ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm",
                scrapedAt: now,
              },
            });
          } catch {
            // ignore — bir snapshot kaybı kritik değil
          }
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

    // 7. Her bilinen competitor URL'i için Serper'da match varsa fiyatı güncelle
    let updatedCount = 0;

    for (const result of serperResults) {
      const matchingCompetitors = competitorByUrl.get(result.link);
      if (!matchingCompetitors || matchingCompetitors.length === 0) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      const retailer = extractRetailer(result.link);

      for (const c of matchingCompetitors) {
        try {
          await prisma.competitor.update({
            where: { id: c.id },
            data: {
              currentPrice: price,
              competitorName: result.title || c.competitorName,
              lastScrapedAt: now,
            },
          });

          await prisma.competitorPrice.create({
            data: {
              competitorId: c.id,
              price,
              currency: "TRY",
              inStock: true,
              scrapedAt: now,
            },
          });

          await prisma.priceHistory.create({
            data: {
              trackedProductId: c.trackedProductId,
              price,
              currency: "TRY",
              inStock: true,
              sellerName: retailer.name,
              scrapedAt: now,
            },
          });

          updatedCount++;
        } catch (err) {
          console.error(`Competitor update hatası (${c.id}):`, err);
        }
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
