import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import { verifyProductMatch } from "../matcher";
import { randomUUID } from "crypto";

interface OnboardJobData {
  productId: string;
  title: string;
  url: string;
}

export async function processCompetitorJob(job: Job<OnboardJobData>) {
  const { productId, title, url } = job.data;
  console.log(`🔍 Competitor arama başlıyor: ${title} (${productId})`);

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

    // Competitor kaydını upsert et (link unique)
    try {
      await prisma.$executeRaw`
        INSERT INTO "Competitor" ("id", "productId", "title", "price", "currency", "link", "imageUrl", "retailer", "lastSeenAt")
        VALUES (${randomUUID()}, ${productId}, ${result.title}, ${price}, 'TRY', ${result.link}, ${result.imageUrl ?? null}, ${retailer.name}, ${now})
        ON CONFLICT ("productId", "link")
        DO UPDATE SET
          "price" = ${price},
          "title" = ${result.title},
          "retailer" = ${retailer.name},
          "lastSeenAt" = ${now}
      `;

      // price_history'ye snapshot ekle
      await prisma.$executeRaw`
        INSERT INTO "PriceHistory" ("id", "productId", "retailer", "price", "currency", "recordedAt")
        VALUES (${randomUUID()}, ${productId}, ${retailer.name}, ${price}, 'TRY', ${now})
      `;

      savedCount++;
    } catch (err) {
      console.error(`Competitor kaydetme hatası (${result.link}):`, err);
      // Tek bir competitor hatasında tüm job'ı öldürme, devam et
    }
  }

  console.log(`✅ ${productId}: ${savedCount} competitor bulundu ve kaydedildi`);
  return { found: savedCount };
}
