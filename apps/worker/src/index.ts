import "dotenv/config";
import { validateWorkerEnv } from "@competehive/shared";
import { scrapeWorker, alertWorker, scheduleScans } from "./jobs/processor";
import { competitorWorker } from "./jobs/competitor-processor";
import { logger } from "./utils/logger";

// ============================================
// CompeteHive Worker Service
// ============================================

const SCAN_INTERVAL_MS = 60 * 1000; // Her 1 dakikada scheduler çalışsın

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
    logger.error({ jobId: job?.id, error: err.message }, "Competitor job failed");
  });

  // İlk taramayı hemen başlat
  await scheduleScans();

  // Periyodik tarama scheduler
  setInterval(async () => {
    try {
      await scheduleScans();
    } catch (error) {
      logger.error({ error }, "Scheduler error");
    }
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

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ error }, "Worker failed to start");
  process.exit(1);
});
