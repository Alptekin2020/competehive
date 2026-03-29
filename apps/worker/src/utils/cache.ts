import IORedis from "ioredis";
import { logger } from "./logger";
import crypto from "crypto";

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return redis;
}

// ============================================
// Cache Key Generation
// ============================================

function generateCacheKey(prefix: string, data: string): string {
  const hash = crypto.createHash("md5").update(data).digest("hex").slice(0, 12);
  return `cache:${prefix}:${hash}`;
}

// ============================================
// Generic Cache Get/Set
// ============================================

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = getRedis();
    const data = await r.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    logger.warn({ error, key }, "Cache get failed");
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const r = getRedis();
    await r.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.warn({ error, key }, "Cache set failed");
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const r = getRedis();
    await r.del(key);
  } catch (error) {
    logger.warn({ error, key }, "Cache delete failed");
  }
}

// ============================================
// Serper-Specific Cache
// ============================================

const SERPER_CACHE_TTL = 30 * 60; // 30 minutes

export function serperCacheKey(query: string, gl: string = "tr"): string {
  return generateCacheKey("serper", `${query}:${gl}`);
}

export async function getCachedSerperResults(
  query: string,
  gl: string = "tr",
): Promise<unknown[] | null> {
  const key = serperCacheKey(query, gl);
  const cached = await cacheGet<unknown[]>(key);
  if (cached) {
    logger.info({ query: query.slice(0, 50), resultCount: cached.length }, "Serper cache HIT");
  }
  return cached;
}

export async function setCachedSerperResults(
  query: string,
  results: unknown[],
  gl: string = "tr",
): Promise<void> {
  const key = serperCacheKey(query, gl);
  await cacheSet(key, results, SERPER_CACHE_TTL);
  logger.info(
    { query: query.slice(0, 50), resultCount: results.length, ttl: SERPER_CACHE_TTL },
    "Serper results cached",
  );
}

// ============================================
// Scrape Result Cache (per-URL)
// ============================================

const SCRAPE_CACHE_TTL = 10 * 60; // 10 minutes

export function scrapeCacheKey(url: string): string {
  return generateCacheKey("scrape", url);
}

export async function getCachedScrapeResult<T>(url: string): Promise<T | null> {
  const key = scrapeCacheKey(url);
  const cached = await cacheGet<T>(key);
  if (cached) {
    logger.info({ url: url.slice(0, 80) }, "Scrape cache HIT");
  }
  return cached;
}

export async function setCachedScrapeResult(url: string, result: unknown): Promise<void> {
  const key = scrapeCacheKey(url);
  await cacheSet(key, result, SCRAPE_CACHE_TTL);
}

// ============================================
// Cache Stats (for monitoring)
// ============================================

export async function getCacheStats(): Promise<{ keys: number; memoryUsed: string }> {
  try {
    const r = getRedis();
    const info = await r.info("memory");
    const memMatch = info.match(/used_memory_human:(.+)/);
    const memory = memMatch ? memMatch[1].trim() : "unknown";

    const cacheKeys = await r.keys("cache:*");

    return {
      keys: cacheKeys.length,
      memoryUsed: memory,
    };
  } catch {
    return { keys: 0, memoryUsed: "unknown" };
  }
}
