import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { scrapeWorker, alertWorker, scheduleScans } from "./jobs/processor";
import { processCompetitorJob } from "./jobs/competitor-processor";
import { processRefreshJob } from "./jobs/refresh-product";
import { prisma } from "./db";
import { logger } from "./utils/logger";
import { startHealthServer } from "./health";

// Redis bağlantısı
const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
  maxRetriesPerRequest: null,
};

// ============================================
// PRODUCT-JOBS QUEUE (onboard + refresh)
// ============================================

export const productQueue = new Queue("product-jobs", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
  },
});

const productWorker = new Worker(
  "product-jobs",
  async (job) => {
    logger.info({ jobName: job.name, jobId: job.id }, "Product job received");

    switch (job.name) {
      case "onboard":
        return processCompetitorJob(job);
      case "refresh":
        return processRefreshJob(job);
      default:
        logger.warn({ jobName: job.name }, "Unknown product job type");
        return undefined;
    }
  },
  {
    connection,
    concurrency: 3,
  },
);

productWorker.on("completed", (job) => {
  logger.info({ jobName: job.name, jobId: job.id }, "Product job completed");
});

productWorker.on("failed", (job, err) => {
  logger.error({ jobName: job?.name, jobId: job?.id }, `Product job failed: ${err.message}`);
});

// ============================================
// COMPETITOR QUEUE (web app'ten gelen find-competitors job'ları)
// ============================================

const competitorWorker = new Worker(
  "competitors",
  async (job) => {
    logger.info({ jobName: job.name, jobId: job.id }, "Competitor search job received");

    const { productId, productName, marketplace: _marketplace } = job.data;
    return processCompetitorJob({
      ...job,
      data: { productId, title: productName, url: "" },
    } as typeof job);
  },
  {
    connection,
    concurrency: 3,
  },
);

competitorWorker.on("completed", (job) => {
  logger.info({ jobName: job.name, jobId: job.id }, "Competitor search job completed");
});

competitorWorker.on("failed", (job, err) => {
  logger.error(
    { jobName: job?.name, jobId: job?.id },
    `Competitor search job failed: ${err.message}`,
  );
});

// ============================================
// STARTUP
// ============================================

async function start() {
  logger.info("CompeteHive Worker starting...");

  // Mevcut scrape scheduler — her 60 saniyede bir tarama zamanı gelen ürünleri kuyruğa ekle
  setInterval(async () => {
    try {
      await scheduleScans();
    } catch (err) {
      logger.error({ err }, "Schedule scan error");
    }
  }, 60 * 1000);

  // İlk çalıştırmada da tarama planla
  await scheduleScans();

  // 3 saatlik periyodik refresh — URL dedup ile (aynı URL için tek Serper çağrısı)
  setInterval(
    async () => {
      try {
        // Unique URL'leri bul — her URL için sadece 1 temsilci ürün seç
        const uniqueProducts = await prisma.$queryRaw<
          Array<{
            id: string;
            product_url: string;
            product_name: string;
            marketplace: string;
            total_subscribers: number;
          }>
        >`
          SELECT DISTINCT ON (product_url)
            id, product_url, product_name, marketplace,
            (SELECT COUNT(*) FROM tracked_products tp2
             WHERE tp2.product_url = tracked_products.product_url
             AND tp2.status IN ('ACTIVE', 'OUT_OF_STOCK')) as total_subscribers
          FROM tracked_products
          WHERE status IN ('ACTIVE', 'OUT_OF_STOCK')
          ORDER BY product_url, last_scraped_at ASC NULLS FIRST
        `;

        let scheduled = 0;
        for (const product of uniqueProducts) {
          await productQueue.add(
            "refresh",
            {
              productId: product.id,
              isDeduped: true, // Flag: bu refresh sonucu aynı URL'deki diğer ürünlere de yansıtılacak
            },
            {
              jobId: `refresh-dedup-${product.id}-${Date.now()}`,
            },
          );
          scheduled++;
        }

        logger.info(
          {
            uniqueUrls: uniqueProducts.length,
            scheduled,
          },
          "Dedup refresh scheduled (3h cycle)",
        );
      } catch (err) {
        logger.error({ err }, "Refresh scheduler error");
      }
    },
    3 * 60 * 60 * 1000,
  ); // 3 saat

  // Start health check HTTP server (Railway uses this for health checks)
  startHealthServer(parseInt(process.env.PORT || "8080"));

  logger.info("CompeteHive Worker started successfully");
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function shutdown() {
  logger.info("Shutting down workers...");
  await Promise.all([
    scrapeWorker.close(),
    alertWorker.close(),
    productWorker.close(),
    competitorWorker.close(),
  ]);
  await prisma.$disconnect();
  logger.info("Workers shut down successfully");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
