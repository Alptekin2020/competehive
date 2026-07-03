import IORedis from "ioredis";

import { logger } from "./logger";

// Seviye-tetiklemeli kurallar (PRICE_THRESHOLD, COMPETITOR_CHEAPER,
// LOW_MARGIN) için koşul-durumu takibi: koşul sürekli doğruyken her fiyat
// olayında aynı uyarıyı yeniden göndermek (cooldown başına 1) uyarı
// yorgunluğunun klasik sebebidir. Durum Redis'te tutulur; yalnızca
// false→true GEÇİŞİNDE uyarı gönderilir, koşul false olunca yeniden kurulur.
// Redis yoksa null döner ve çağıran mevcut davranışa (cooldown) geri düşer.
const STATE_KEY_PREFIX = "alert-state:";
const STATE_TTL_SECONDS = 14 * 24 * 60 * 60;

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    redis.on("error", (err) => {
      logger.warn({ err: err.message }, "Alert-state Redis error");
    });
  }
  return redis;
}

function stateKey(ruleId: string, productId: string): string {
  return `${STATE_KEY_PREFIX}${ruleId}:${productId}`;
}

export async function getAlertConditionState(
  ruleId: string,
  productId: string,
): Promise<boolean | null> {
  try {
    const value = await getRedis().get(stateKey(ruleId, productId));
    if (value === null) return null;
    return value === "1";
  } catch (err) {
    logger.warn({ err, ruleId, productId }, "Alert-state read failed");
    return null;
  }
}

export async function setAlertConditionState(
  ruleId: string,
  productId: string,
  active: boolean,
): Promise<void> {
  try {
    await getRedis().set(stateKey(ruleId, productId), active ? "1" : "0", "EX", STATE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, ruleId, productId }, "Alert-state write failed");
  }
}
