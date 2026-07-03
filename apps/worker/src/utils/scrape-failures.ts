import IORedis from "ioredis";

import { logger } from "./logger";

// Ürün başına ardışık scrape hatası sayacı (Redis). Eşik aşılınca ürün ERROR
// durumuna alınır ki kullanıcı "taze görünen bayat fiyat" yerine dürüst bir
// hata durumu görsün. Başarılı taramada sayaç sıfırlanır. Redis yoksa sayaç
// çalışmaz (null döner) — bu durumda ERROR'a geçiş yapılmaz, mevcut davranış
// (soft-fail) korunur; sayaç TTL'i sayesinde eski hatalar kendiliğinden düşer.
const FAILURE_KEY_PREFIX = "scrape-failures:";
const FAILURE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Ardışık bu kadar başarısız denemeden sonra ürün ERROR olarak işaretlenir.
// Zamanlanmış taramalar 3'er denemelik job'lar halinde geldiği için eşik 5,
// kabaca 15 ardışık başarısız HTTP denemesine denk gelir.
export const SCRAPE_FAILURE_THRESHOLD = 5;

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    redis.on("error", (err) => {
      logger.warn({ err: err.message }, "Scrape-failure counter Redis error");
    });
  }
  return redis;
}

function failureKey(productId: string): string {
  return `${FAILURE_KEY_PREFIX}${productId}`;
}

export async function incrementScrapeFailure(productId: string): Promise<number | null> {
  try {
    const key = failureKey(productId);
    const count = await getRedis().incr(key);
    await getRedis().expire(key, FAILURE_TTL_SECONDS);
    return count;
  } catch (err) {
    logger.warn({ err, productId }, "Scrape-failure increment failed");
    return null;
  }
}

export async function clearScrapeFailures(productId: string): Promise<void> {
  try {
    await getRedis().del(failureKey(productId));
  } catch (err) {
    logger.warn({ err, productId }, "Scrape-failure clear failed");
  }
}
