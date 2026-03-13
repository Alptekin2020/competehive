import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import { verifyProductMatch } from "../matcher";
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

  // Ürünün var olduğunu doğrula
  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
  });

  if (!product) {
    console.warn(`⚠️ Ürün bulunamadı: ${productId}`);
    return { found: 0 };
  }

  // 1. Serper ile ürünü ara
  let results;
  try {
    results = await searchProduct(title);
  } catch (err) {
    console.error(`Serper arama hatası (${productId}):`, err);
    throw err;
  }

  if (!results || results.length === 0) {
    console.log(`⚠️ Sonuç bulunamadı: ${title}`);
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

    // AI ile eşleştirme doğrula
    let isMatch = false;
    try {
      isMatch = await verifyProductMatch(title, result.title);
    } catch {
      // Hata durumunda bu sonucu atla
      continue;
    }

    if (!isMatch) continue;

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
        },
        create: {
          trackedProductId: productId,
          competitorUrl: result.link,
          competitorName: result.title,
          marketplace,
          currentPrice: price,
          lastScrapedAt: now,
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

  console.log(`✅ ${productId}: ${savedCount} competitor bulundu ve kaydedildi`);
  return { found: savedCount };
}
