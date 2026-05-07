import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { scrapeWorker, alertWorker, scheduleScans } from "./jobs/processor";
import { processCompetitorJob } from "./jobs/competitor-processor";
import { processRefreshJob } from "./jobs/refresh-product";
import { processRefreshUrlJob } from "./jobs/refresh-product-url";
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
      case "refresh-url":
        return processRefreshUrlJob(job);
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

  // 6 saatlik URL-DEDUP refresh scheduler
  // ÖNCEDEN: her TrackedProduct için 1 job → N kullanıcı × M ürün = N×M Serper call
  // ŞİMDİ: distinct productUrl başına 1 job → unique URL sayısı kadar Serper call
  setInterval(
    async () => {
      try {
        const uniqueUrlProducts = await prisma.trackedProduct.findMany({
          where: { status: { in: ["ACTIVE", "OUT_OF_STOCK"] } },
          distinct: ["productUrl"],
          select: { productUrl: true },
        });

        for (const { productUrl } of uniqueUrlProducts) {
          await productQueue.add(
            "refresh-url",
            { productUrl },
            {
              jobId: `refresh-url-${productUrl}-${Date.now()}`,
            },
          );
        }

        logger.info(`Scheduled ${uniqueUrlProducts.length} refresh-url jobs (URL-deduped)`);
      } catch (err) {
        logger.error({ err }, "Refresh-url scheduler error");
      }
    },
    6 * 60 * 60 * 1000,
  );

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
