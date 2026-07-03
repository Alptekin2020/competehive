import IORedis from "ioredis";

import { logger } from "./logger";

// Worker canlılık sinyali: web'in /api/health endpoint'i bu anahtarın yaşına
// bakarak "worker ölü → tarama ve uyarı yok" durumunu görünür kılar. Anahtar
// TTL'lidir; worker durursa 10 dakika içinde kendiliğinden kaybolur.
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
const HEARTBEAT_TTL_SECONDS = 600;

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    redis.on("error", (err) => {
      logger.warn({ err: err.message }, "Heartbeat Redis error");
    });
  }
  return redis;
}

export async function beatHeartbeat(): Promise<void> {
  try {
    await getRedis().set(
      WORKER_HEARTBEAT_KEY,
      new Date().toISOString(),
      "EX",
      HEARTBEAT_TTL_SECONDS,
    );
  } catch (err) {
    // Redis geçici olarak yoksa kalp atışı atlanır — bir sonraki tick dener.
    logger.warn({ err }, "Heartbeat write failed");
  }
}
