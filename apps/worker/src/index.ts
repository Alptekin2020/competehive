import "dotenv/config";
import { validateWorkerEnv } from "./shared";
import { scrapeWorker, alertWorker, scheduleScans } from "./jobs/processor";
import { competitorWorker } from "./jobs/competitor-processor";
import { logger } from "./utils/logger";

// ============================================
// CompeteHive Worker Service
// ============================================

const SCAN_INTERVAL_MS = 60 * 1000; // Her 1 dakikada scheduler çalışsın

function toLoggableError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { value: String(error) };
}

async function runSchedulerTick(reason: "startup" | "interval") {
  try {
    await scheduleScans();
    logger.info({ reason }, "Scheduler tick completed");
  } catch (error) {
    logger.error({ reason, error: toLoggableError(error) }, "Scheduler tick failed");
  }
}

async function main() {
  validateWorkerEnv();
  logger.info("🐝 CompeteHive Worker starting...");

  // Workers otomatik başlıyor (oluşturulduklarında)
  logger.info("✅ Scrape worker ready (concurrency: 5)");
  logger.info("✅ Alert worker ready (concurrency: 10)");
  logger.info("✅ Competitor worker ready");

  // Add event handlers for competitor worker
  competitorWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Competitor job completed");
  });

  competitorWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: toLoggableError(err) }, "Competitor job failed");
  });

  // İlk taramayı hemen başlat (hata olursa process'i düşürme)
  await runSchedulerTick("startup");

  // Periyodik tarama scheduler
  setInterval(() => {
    void runSchedulerTick("interval");
  }, SCAN_INTERVAL_MS);

  logger.info(`🔄 Scheduler running every ${SCAN_INTERVAL_MS / 1000}s`);
  logger.info("🐝 CompeteHive Worker is running!");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    await scrapeWorker.close();
    await alertWorker.close();
    await competitorWorker.close();
    logger.info("Workers closed. Goodbye!");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error) => {
  logger.fatal({ error: toLoggableError(error) }, "Worker failed to start");
  process.exit(1);
});
