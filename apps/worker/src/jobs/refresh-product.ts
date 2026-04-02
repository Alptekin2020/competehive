import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";
import { getScraper } from "../scrapers";

interface RefreshJobData {
  productId: string;
}

export async function processRefreshJob(job: Job<RefreshJobData>) {
  const { productId } = job.data;

  // Prisma ORM ile ürün ve mevcut competitors çek
  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
    include: {
      competitors: true,
    },
  });

  if (!product) {
    console.warn(`⚠️ Refresh: ürün bulunamadı ${productId}`);
    return;
  }

  console.log(`🔄 Fiyat yenileniyor: ${product.productName} (${productId})`);

  // Mark as processing
  await updateTrackedProductRefresh(productId, { refreshStatus: "processing" });

  try {
    const now = new Date();
    let refreshedOwnPrice: number | null = null;

    // Tracked product source URL'sini tekrar scrape et (kendi fiyatını gerçekten yenile)
    try {
      const scraper = getScraper(product.marketplace);
      const sourceData = await scraper(product.productUrl);

      if (sourceData?.price && sourceData.price > 0) {
        refreshedOwnPrice = sourceData.price;
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

        if (sourceData.name && sourceData.name.trim().length > 3) {
          updateData.productName = sourceData.name.trim();
        }
        if (sourceData.imageUrl && sourceData.imageUrl.trim().length > 0) {
          updateData.productImage = sourceData.imageUrl.trim();
        }
        if (sourceData.sellerName && sourceData.sellerName.trim().length > 0) {
          updateData.sellerName = sourceData.sellerName.trim();
        }

        await prisma.trackedProduct.update({
          where: { id: productId },
          data: updateData,
        });

        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: sourceData.price,
            currency: sourceData.currency || product.currency,
            inStock: sourceData.inStock,
            sellerName:
              sourceData.sellerName ||
              (extractRetailer(product.productUrl).name !== "Diğer"
                ? extractRetailer(product.productUrl).name
                : "Benim Ürünüm"),
            scrapedAt: now,
          },
        });

        console.log(
          `✅ Source refresh başarılı: ${productId} — ${sourceData.price} ${sourceData.currency}`,
        );
      } else {
        console.warn(
          `⚠️ Source refresh price bulunamadı: ${productId} (${product.marketplace}) ${product.productUrl}`,
        );
      }
    } catch (sourceError) {
      console.error(
        `⚠️ Source refresh scrape hatası: ${productId} (${product.marketplace}) ${product.productUrl}`,
        sourceError,
      );
    }

    // Optimize edilmiş sorgu kullan (metadata varsa)
    let refreshQuery = product.productName;
    const refreshMetadata = product.metadata as Record<string, unknown> | null;
    if (refreshMetadata) {
      const analysis = (refreshMetadata.analysis || refreshMetadata) as Record<string, unknown>;
      if (
        analysis.searchKeywords &&
        Array.isArray(analysis.searchKeywords) &&
        analysis.searchKeywords.length > 0
      ) {
        refreshQuery = analysis.searchKeywords[0] as string;
      } else if (analysis.shortTitle && typeof analysis.shortTitle === "string") {
        refreshQuery = analysis.shortTitle;
      }
    }

    // Serper'dan güncel fiyatları çek
    const results = await searchProduct(refreshQuery);

    let updatedCount = 0;

    // Mevcut competitor'ların URL'lerini map'e al
    const competitorByUrl = new Map<
      string,
      { competitorUrl: string; id: string; competitorName: string | null }
    >(
      product.competitors.map(
        (c: { competitorUrl: string; id: string; competitorName: string | null }) => [
          c.competitorUrl,
          c,
        ],
      ),
    );

    for (const result of results) {
      // Sadece zaten bilinen competitor'ları güncelle
      const existingCompetitor = competitorByUrl.get(result.link);
      if (!existingCompetitor) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      const retailer = extractRetailer(result.link);

      try {
        // Competitor fiyatını güncelle
        await prisma.competitor.update({
          where: { id: existingCompetitor.id },
          data: {
            currentPrice: price,
            competitorName: result.title || existingCompetitor.competitorName,
            lastScrapedAt: now,
          },
        });

        // CompetitorPrice tablosuna snapshot ekle
        await prisma.competitorPrice.create({
          data: {
            competitorId: existingCompetitor.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });

        // PriceHistory tablosuna snapshot ekle (detail sayfası için)
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

        updatedCount++;
      } catch (err) {
        console.error(`Refresh güncelleme hatası (${result.link}):`, err);
      }
    }

    // Source scrape başarısızsa fallback olarak mevcut kendi fiyatını history'ye kaydet
    if (!refreshedOwnPrice && product.currentPrice && Number(product.currentPrice) > 0) {
      const ownRetailer = extractRetailer(product.productUrl);
      try {
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: Number(product.currentPrice),
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

    console.log(`✅ Refresh tamamlandı: ${productId} — ${updatedCount} competitor güncellendi`);
    return { updated: updatedCount };
  } catch (error) {
    // Mark as failed
    try {
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "failed",
        refreshCompletedAt: new Date(),
        refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
      });
    } catch (statusUpdateError) {
      console.error("Failed to update refresh status:", statusUpdateError);
    }
    throw error; // re-throw so BullMQ marks the job as failed
  }
}
