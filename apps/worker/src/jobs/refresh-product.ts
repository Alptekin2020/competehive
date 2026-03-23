import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";

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
  await prisma.trackedProduct.update({
    where: { id: productId },
    data: { refreshStatus: "processing" },
  });

  try {
    // Serper'dan güncel fiyatları çek
    const results = await searchProduct(product.productName);

    const now = new Date();
    let updatedCount = 0;

    // Mevcut competitor'ların URL'lerini map'e al
    const competitorByUrl = new Map(product.competitors.map((c) => [c.competitorUrl, c]));

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

    // Kullanıcının kendi ürün fiyatını da PriceHistory'ye kaydet
    if (product.currentPrice && Number(product.currentPrice) > 0) {
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
    await prisma.trackedProduct.update({
      where: { id: productId },
      data: {
        refreshStatus: "completed",
        refreshCompletedAt: new Date(),
        refreshError: null,
      },
    });

    console.log(`✅ Refresh tamamlandı: ${productId} — ${updatedCount} competitor güncellendi`);
    return { updated: updatedCount };
  } catch (error) {
    // Mark as failed
    try {
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: {
          refreshStatus: "failed",
          refreshCompletedAt: new Date(),
          refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
        },
      });
    } catch (statusUpdateError) {
      console.error("Failed to update refresh status:", statusUpdateError);
    }
    throw error; // re-throw so BullMQ marks the job as failed
  }
}
