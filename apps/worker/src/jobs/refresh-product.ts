import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import { randomUUID } from "crypto";
import { Client } from "pg";

interface RefreshJobData {
  productId: string;
}

interface CompetitorRow {
  id: string;
  link: string;
}

export async function processRefreshJob(job: Job<RefreshJobData>) {
  const { productId } = job.data;

  // Raw query ile product ve competitors çek (custom tablolar)
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const productResult = await client.query(
      `SELECT "id", "title", "url", "price", "currency" FROM "Product" WHERE "id" = $1`,
      [productId],
    );

    if (productResult.rows.length === 0) {
      console.warn(`⚠️ Refresh: ürün bulunamadı ${productId}`);
      return;
    }

    const product = productResult.rows[0];
    console.log(`🔄 Fiyat yenileniyor: ${product.title} (${productId})`);

    // Mevcut competitors çek
    const competitorsResult = await client.query(
      `SELECT "id", "link" FROM "Competitor" WHERE "productId" = $1`,
      [productId],
    );
    const competitors: CompetitorRow[] = competitorsResult.rows;

    // Serper'dan güncel fiyatları çek
    let results;
    try {
      results = await searchProduct(product.title);
    } catch (err) {
      console.error(`Refresh Serper hatası (${productId}):`, err);
      throw err;
    }

    const now = new Date();
    let updatedCount = 0;

    // Mevcut competitor'ların linklerini map'e al
    const competitorByLink = new Map(competitors.map((c) => [c.link, c]));

    for (const result of results) {
      // Sadece zaten bilinen competitor'ları güncelle
      const existingCompetitor = competitorByLink.get(result.link);
      if (!existingCompetitor) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;

      const retailer = extractRetailer(result.link);

      try {
        // Competitor fiyatını güncelle
        await client.query(
          `UPDATE "Competitor" SET "price" = $1, "retailer" = $2, "lastSeenAt" = $3 WHERE "id" = $4`,
          [price, retailer.name, now, existingCompetitor.id],
        );

        // price_history snapshot ekle
        await client.query(
          `INSERT INTO "PriceHistory" ("id", "productId", "retailer", "price", "currency", "recordedAt")
           VALUES ($1, $2, $3, $4, 'TRY', $5)`,
          [randomUUID(), productId, retailer.name, price, now],
        );

        updatedCount++;
      } catch (err) {
        console.error(`Refresh güncelleme hatası (${result.link}):`, err);
      }
    }

    // Kullanıcının kendi ürün fiyatı da varsa onu da kaydet
    if (product.price && product.price > 0) {
      const ownRetailer = extractRetailer(product.url);
      try {
        await client.query(
          `INSERT INTO "PriceHistory" ("id", "productId", "retailer", "price", "currency", "recordedAt")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            productId,
            ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm",
            product.price,
            product.currency ?? "TRY",
            now,
          ],
        );
      } catch (err) {
        console.error(`Kendi fiyatı kaydetme hatası:`, err);
      }
    }

    console.log(`✅ Refresh tamamlandı: ${productId} — ${updatedCount} competitor güncellendi`);
    return { updated: updatedCount };
  } finally {
    await client.end();
  }
}
