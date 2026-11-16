// ============================================
// AI red önbelleği (negatif önbellek)
// ============================================
//
// Aynı aday her keşif turunda yeniden AI'a soruluyordu: kesin redler (skor
// < 40: farklı ürün, farklı marka) 6 saatte bir aynı cevabı alıp maliyet
// üretiyordu. Red, (ürün, competitorUrlKey) çifti için 7 gün Redis'te tutulur;
// isabette AI çağrısı atlanır. Redis yoksa/yavaşsa her zaman AI'a gidilir
// (fail open) — önbellek yalnızca bir tasarruftur, karar kaynağı değildir.
//
// Kurallar değişince eski redlerin yeni deterministik kabulleri gölgelememesi
// için: anahtar bir sürüm taşır, isabette de ucuz deterministik başlık kuralı
// (reevaluate) çalıştırılır ve ortak model kodu olan çiftler hiç önbelleğe
// bakılmadan matcher'a gider (kod yolu AI'sız karar verir).

import crypto from "crypto";
import { cacheGet, cacheSet } from "./cache";
import { compareProductCodes } from "./competitor-quality";
import { logger } from "./logger";

export const REJECT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REJECT_CACHE_MAX_SCORE = 40;
const REJECT_CACHE_VERSION = 1;
const REDIS_TIMEOUT_MS = 500;

export interface CachedRejection {
  score: number;
  reason: string;
}

export interface RejectCacheStore {
  get(key: string): Promise<CachedRejection | null>;
  set(key: string, value: CachedRejection, ttlSeconds: number): Promise<void>;
}

/** Redis çağrısı zaman aşımına uğrarsa null döner (bağlantı yoksa ioredis kuyrukta bekletir). */
async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), REDIS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const redisRejectCacheStore: RejectCacheStore = {
  get: (key) => withTimeout(cacheGet<CachedRejection>(key), null),
  set: (key, value, ttl) => withTimeout(cacheSet(key, value, ttl), undefined),
};

export function rejectCacheKey(productId: string, urlKey: string): string {
  const hash = crypto.createHash("sha1").update(urlKey).digest("hex").slice(0, 16);
  return `ai-reject:v${REJECT_CACHE_VERSION}:${productId}:${hash}`;
}

/** Bu çift için önbelleğe bakılmalı mı? Ortak/benzer model kodu varsa hayır. */
export function rejectCacheApplies(sourceTitle: string, candidateTitle: string): boolean {
  return compareProductCodes(sourceTitle, candidateTitle) === "none";
}

/** Önbelleğe yazılacak red mi? Yalnızca AI'ın verdiği kesin redler (< 40). */
export function isCacheableRejection(result: {
  isMatch: boolean;
  score: number;
  aiUnavailable?: boolean;
}): boolean {
  return !result.isMatch && !result.aiUnavailable && result.score < REJECT_CACHE_MAX_SCORE;
}

export async function readCachedRejection(
  productId: string,
  urlKey: string,
  store: RejectCacheStore = redisRejectCacheStore,
): Promise<CachedRejection | null> {
  if (!productId || !urlKey) return null;
  try {
    const hit = await store.get(rejectCacheKey(productId, urlKey));
    if (!hit || typeof hit.score !== "number") return null;
    return { score: hit.score, reason: typeof hit.reason === "string" ? hit.reason : "" };
  } catch (err) {
    logger.warn({ err, productId }, "AI rejection cache read failed — calling AI");
    return null;
  }
}

export async function writeCachedRejection(
  productId: string,
  urlKey: string,
  rejection: CachedRejection,
  store: RejectCacheStore = redisRejectCacheStore,
): Promise<void> {
  if (!productId || !urlKey) return;
  try {
    await store.set(rejectCacheKey(productId, urlKey), rejection, REJECT_CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, productId }, "AI rejection cache write failed");
  }
}
