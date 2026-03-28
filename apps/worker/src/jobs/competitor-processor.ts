import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import { verifyProductMatch, MatchResult } from "../matcher";
import { Marketplace } from "@prisma/client";

interface OnboardJobData {
  productId: string;
  title: string;
  url: string;
}

/**
 * Domain → Prisma Marketplace enum eşlemesi.
 * extractRetailer name → Marketplace enum.
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

export async function processCompetitorJob(job: Job<OnboardJobData>) {
  const { productId, title, url } = job.data;
  console.log(`🔍 Competitor arama başlıyor: ${title} (${productId})`);

  // Mark as processing
  try {
    await prisma.trackedProduct.update({
      where: { id: productId },
      data: { refreshStatus: "processing" },
    });
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
    // 1. Serper ile ürünü ara
    const results = await searchProduct(title);

    if (!results || results.length === 0) {
      console.log(`⚠️ Sonuç bulunamadı: ${title}`);
      // Mark as completed even with 0 results
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: {
          refreshStatus: "completed",
          refreshCompletedAt: new Date(),
          refreshError: null,
        },
      });
      return { found: 0 };
    }

    const now = new Date();
    let savedCount = 0;

    for (const result of results) {
      // Kendi URL'imizi atla
      if (result.link === url) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      const retailer = extractRetailer(result.link);

      // AI ile eşleştirme doğrula (enhanced: score + reason)
      let matchResult: MatchResult;
      try {
        matchResult = await verifyProductMatch(
          {
            title,
            price: product.currentPrice ? Number(product.currentPrice) : undefined,
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
        // Hata durumunda bu sonucu atla
        continue;
      }

      if (!matchResult.isMatch) {
        console.log(
          `❌ Candidate rejected (score: ${matchResult.score}): ${result.title.slice(0, 50)} — ${matchResult.reason}`,
        );
        continue;
      }

      const marketplace = retailerToMarketplace(retailer.name);

      // Competitor kaydını upsert et (Prisma ORM ile)
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

        // CompetitorPrice tablosuna snapshot ekle
        await prisma.competitorPrice.create({
          data: {
            competitorId: competitor.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });

        // PriceHistory tablosuna da snapshot ekle (detail sayfası için)
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
        // Tek bir competitor hatasında tüm job'ı öldürme, devam et
      }
    }

    // Kullanıcının kendi ürün fiyatını da PriceHistory'ye kaydet
    if (product.currentPrice && Number(product.currentPrice) > 0) {
      try {
        const ownRetailer = extractRetailer(product.productUrl);
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

    console.log(`✅ ${productId}: ${savedCount} competitor bulundu ve kaydedildi`);
    return { found: savedCount };
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
