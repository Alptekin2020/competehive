import { Queue, Worker, Job } from "bullmq";
import { PrismaClient, Marketplace } from "@prisma/client";
import { getScraper, ScrapedProduct } from "../scrapers";
import { sendAlerts } from "../services/notifications";
import { logger } from "../utils/logger";
import IORedis from "ioredis";

const prisma = new PrismaClient();

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// ============================================
// QUEUES
// ============================================

export const scrapeQueue = new Queue("scrape", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const alertQueue = new Queue("alerts", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  },
});

// ============================================
// SCRAPE WORKER
// ============================================

export const scrapeWorker = new Worker(
  "scrape",
  async (job: Job) => {
    const { productId, marketplace, productUrl } = job.data;

    logger.info({ productId, marketplace }, "Scrape job started");

    try {
      // Scraper'ı al ve çalıştır
      const scraper = getScraper(marketplace);
      const result: ScrapedProduct = await scraper(productUrl);

      // Mevcut fiyatı al
      const product = await prisma.trackedProduct.findUnique({
        where: { id: productId },
        select: { currentPrice: true },
      });

      const previousPrice = product?.currentPrice ? Number(product.currentPrice) : null;
      const priceChange = previousPrice ? result.price - previousPrice : null;
      const priceChangePct = previousPrice && previousPrice > 0
        ? ((result.price - previousPrice) / previousPrice) * 100
        : null;

      // Fiyat geçmişine kaydet
      await prisma.priceHistory.create({
        data: {
          trackedProductId: productId,
          price: result.price,
          previousPrice: previousPrice,
          currency: result.currency,
          priceChange: priceChange,
          priceChangePct: priceChangePct,
          inStock: result.inStock,
          sellerName: result.sellerName,
        },
      });

      // Ürünü güncelle
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: {
          currentPrice: result.price,
          productName: result.name || undefined,
          productImage: result.imageUrl || undefined,
          sellerName: result.sellerName || undefined,
          category: result.category || undefined,
          lastScrapedAt: new Date(),
          status: result.inStock ? "ACTIVE" : "OUT_OF_STOCK",
          metadata: result.metadata || undefined,
        },
      });

      // Fiyat değişikliği varsa alert kontrolü yap
      if (priceChange !== null && priceChange !== 0) {
        await alertQueue.add("check-alerts", {
          productId,
          currentPrice: result.price,
          previousPrice,
          priceChange,
          priceChangePct,
          inStock: result.inStock,
        });
      }

      logger.info({
        productId,
        name: result.name,
        price: result.price,
        change: priceChange,
        changePct: priceChangePct?.toFixed(2),
      }, "Scrape completed");

      return { success: true, price: result.price };
    } catch (error) {
      logger.error({ productId, error }, "Scrape job failed");

      // Hata durumunu güncelle
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: { status: "ERROR" },
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 5, // Aynı anda 5 scrape
    limiter: {
      max: 10,      // 10 saniyede max 10 istek
      duration: 10000,
    },
  }
);

// ============================================
// ALERT WORKER
// ============================================

export const alertWorker = new Worker(
  "alerts",
  async (job: Job) => {
    const { productId, currentPrice, previousPrice, priceChange, priceChangePct, inStock } = job.data;

    logger.info({ productId, priceChange }, "Checking alerts");

    // Bu ürün için aktif kuralları al
    const rules = await prisma.alertRule.findMany({
      where: {
        trackedProductId: productId,
        isActive: true,
      },
      include: {
        user: true,
        trackedProduct: true,
      },
    });

    for (const rule of rules) {
      let shouldAlert = false;

      // Cooldown kontrolü
      if (rule.lastTriggered) {
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (Date.now() - rule.lastTriggered.getTime() < cooldownMs) {
          continue;
        }
      }

      // Kural tipine göre kontrol
      switch (rule.ruleType) {
        case "PRICE_DROP":
          shouldAlert = priceChange < 0;
          break;
        case "PRICE_INCREASE":
          shouldAlert = priceChange > 0;
          break;
        case "PRICE_THRESHOLD":
          if (rule.direction === "below") {
            shouldAlert = currentPrice <= Number(rule.thresholdValue);
          } else {
            shouldAlert = currentPrice >= Number(rule.thresholdValue);
          }
          break;
        case "PERCENTAGE_CHANGE":
          shouldAlert = Math.abs(priceChangePct) >= Number(rule.thresholdValue);
          break;
        case "OUT_OF_STOCK":
          shouldAlert = !inStock;
          break;
        case "BACK_IN_STOCK":
          shouldAlert = inStock;
          break;
      }

      if (shouldAlert) {
        await sendAlerts(rule, {
          productName: rule.trackedProduct!.productName,
          currentPrice,
          previousPrice,
          priceChange,
          priceChangePct,
          marketplace: rule.trackedProduct!.marketplace,
          productUrl: rule.trackedProduct!.productUrl,
        });

        // Last triggered güncelle
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggered: new Date() },
        });

        logger.info({ ruleId: rule.id, ruleType: rule.ruleType }, "Alert triggered");
      }
    }
  },
  { connection, concurrency: 10 }
);

// ============================================
// SCHEDULER - Periyodik tarama
// ============================================

export async function scheduleScans() {
  logger.info("Scheduling product scans...");

  // Taranması gereken ürünleri bul
  const now = new Date();
  const products = await prisma.trackedProduct.findMany({
    where: {
      status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
      OR: [
        { lastScrapedAt: null },
        {
          lastScrapedAt: {
            lt: new Date(now.getTime() - 5 * 60 * 1000), // En az 5 dk önce taranmış
          },
        },
      ],
    },
    select: {
      id: true,
      marketplace: true,
      productUrl: true,
      scrapeInterval: true,
      lastScrapedAt: true,
    },
  });

  let scheduled = 0;

  for (const product of products) {
    // Scrape interval kontrolü
    if (product.lastScrapedAt) {
      const intervalMs = product.scrapeInterval * 60 * 1000;
      const elapsed = now.getTime() - product.lastScrapedAt.getTime();
      if (elapsed < intervalMs) continue;
    }

    await scrapeQueue.add(
      `scrape-${product.id}`,
      {
        productId: product.id,
        marketplace: product.marketplace,
        productUrl: product.productUrl,
      },
      {
        jobId: `scrape-${product.id}-${Date.now()}`,
        priority: product.lastScrapedAt ? 2 : 1, // Hiç taranmamışlar öncelikli
      }
    );

    scheduled++;
  }

  logger.info(`Scheduled ${scheduled} scrape jobs`);
}

// Worker event listeners
scrapeWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "Scrape job failed");
});

alertWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "Alert job failed");
});
