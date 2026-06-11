import "dotenv/config";
import { createHash } from "node:crypto";

import { Worker, Queue } from "bullmq";
import { setGlobalDispatcher, ProxyAgent } from "undici";

import { scrapeWorker, alertWorker, scheduleScans } from "./jobs/processor";
import { processCompetitorJob } from "./jobs/competitor-processor";
import { cleanupJunkCompetitors } from "./jobs/competitor-cleanup";
import { refreshStaleCompetitorPrices } from "./jobs/competitor-price-refresh";
import { processRefreshJob } from "./jobs/refresh-product";
import { processRefreshUrlJob } from "./jobs/refresh-product-url";
import { prisma } from "./db";
import { runMigrations } from "./migrate";
import { logger } from "./utils/logger";
import { startHealthServer } from "./health";
import { setWebhook, setMyCommands } from "./utils/telegram-api";
import { validateWorkerEnv } from "./shared";
import { getProxyConfig } from "./utils/proxy";
import { closeBrowser } from "./scrapers";

type TelegramRegistrationResult =
  | { status: "registered"; webhookUrl: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

async function registerTelegramBot(): Promise<TelegramRegistrationResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  if (!token || !secret || !appUrl) {
    const missing = [
      !token && "TELEGRAM_BOT_TOKEN",
      !secret && "TELEGRAM_WEBHOOK_SECRET",
      !appUrl && "NEXT_PUBLIC_APP_URL",
    ]
      .filter(Boolean)
      .join(", ");
    logger.warn("Telegram env vars missing — bot registration skipped");
    return { status: "skipped", reason: `eksik env: ${missing}` };
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`;
  try {
    await setWebhook(token, webhookUrl, secret);
    logger.info({ webhookUrl }, "Telegram webhook registered");

    await setMyCommands(token, [
      { command: "status", description: "Aktif takip durumu" },
      { command: "test", description: "Test bildirimi gönder" },
      { command: "stop", description: "Bildirimleri durdur" },
    ]);
    logger.info("Telegram bot commands set");
    return { status: "registered", webhookUrl };
  } catch (err) {
    logger.error({ err }, "Telegram bot registration failed");
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

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

  // Fail fast on invalid/missing configuration instead of failing late on the
  // first job (e.g. a missing DATABASE_URL surfacing as a deep Prisma error).
  validateWorkerEnv();

  // Route all outbound fetch (scrapers, Serper, Telegram, webhook delivery)
  // through the configured proxy. DB (pg/Prisma) and Redis (ioredis) use their
  // own clients and are unaffected. No proxy env → fetch stays direct.
  const proxy = getProxyConfig();
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy.url));
    logger.info(
      { server: proxy.server, authenticated: Boolean(proxy.username) },
      "Outbound fetch routed through proxy",
    );
  }

  // Reconcile the live schema with packages/database/prisma/schema.prisma. This is
  // an idempotent raw-SQL safety net that runs after `prisma migrate deploy`
  // (start-with-migrate.sh) and force-aligns drifted columns (e.g.
  // notifications.status/error) so the web app's /api/notifications stops 500ing.
  // A failure here must not down the worker — `prisma migrate deploy` is the
  // authoritative migration step.
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, "Schema reconciliation (runMigrations) failed — continuing");
  }

  // Eski keşif turlarından kalan bariz çöp rakipleri (ambalaj/koli ürünleri,
  // aşırı fiyat sapması olan skorsuz kayıtlar) temizle. Idempotent; bir hata
  // worker'ı düşürmemeli.
  try {
    await cleanupJunkCompetitors();
  } catch (err) {
    logger.error({ err }, "Junk-competitor cleanup failed — continuing");
  }

  await registerTelegramBot();

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
          where: {
            status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
            // Plan kapısı (B1): süresi dolmuş ücretli planların ürünleri için
            // Serper araması (maliyet) yapma — scrape scheduler ile aynı kural.
            user: {
              OR: [{ planExpiresAt: null }, { planExpiresAt: { gte: new Date() } }],
            },
          },
          distinct: ["productUrl"],
          select: { productUrl: true },
        });

        for (const { productUrl } of uniqueUrlProducts) {
          // Raw URL'ler özel karakter (`:` `/` `?` `#`) içeriyor ve çok uzun olabiliyor;
          // jobId güvenliği için SHA-1 hash kullanıyoruz (kriptografik amaç değil — sadece kısa stable id).
          const urlHash = createHash("sha1").update(productUrl).digest("hex").slice(0, 16);
          await productQueue.add(
            "refresh-url",
            { productUrl },
            {
              jobId: `refresh-url-${urlHash}-${Date.now()}`,
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

  // Bayat rakip fiyatı tazeleme: bilinen rakip URL'lerini hafif HTTP ile
  // yeniden doğrular (Serper/AI maliyeti yok). 30 dakikada bir; açılıştan
  // 2 dk sonra ilk tur (deploy anında dış sitelere yüklenmemek için).
  setInterval(
    () => {
      refreshStaleCompetitorPrices().catch((err) => {
        logger.error({ err }, "Competitor price refresh scheduler error");
      });
    },
    30 * 60 * 1000,
  );
  setTimeout(
    () => {
      refreshStaleCompetitorPrices().catch((err) => {
        logger.error({ err }, "Initial competitor price refresh error");
      });
    },
    2 * 60 * 1000,
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
  await closeBrowser();
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
