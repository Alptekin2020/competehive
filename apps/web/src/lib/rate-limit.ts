import redis from "@/lib/redis";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

/**
 * Sliding window rate limiter using Redis INCR + EXPIRE.
 * @param key - Unique identifier (e.g., `rate:products:${userId}`)
 * @param maxRequests - Maximum number of requests in the window
 * @param windowSeconds - Window size in seconds
 */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
  options?: { failClosed?: boolean },
): Promise<RateLimitResult> {
  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);

    return {
      success: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
      reset: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    console.warn("Rate limit check failed:", error);
    // Varsayılan fail-open (kullanıcı deneyimi), ama ücretli dış API çağrısı
    // tetikleyen rotalar (Serper/OpenAI) fail-closed ister: Redis kesintisi
    // maliyet korumasını sessizce kaldırmamalı.
    if (options?.failClosed) {
      return { success: false, remaining: 0, reset: windowSeconds };
    }
    return { success: true, remaining: maxRequests, reset: windowSeconds };
  }
}

/**
 * Returns a 429 response helper for rate-limited routes.
 */
export function rateLimitResponse(reset: number) {
  return new Response(JSON.stringify({ error: "Cok fazla istek. Lutfen bekleyin." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(reset),
    },
  });
}

// ============================================
// Sliding Window Rate Limiter (sorted set)
// ============================================

interface SlidingWindowResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface SlidingWindowOptions {
  failClosed?: boolean;
}

/**
 * Sliding window rate limiter using Redis sorted sets.
 * @param identifier - User ID or IP address
 * @param limit - Max requests allowed in the window
 * @param windowSeconds - Window duration in seconds
 * @param prefix - Key prefix to separate different rate limit rules
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number,
  prefix: string = "rl",
  options?: SlidingWindowOptions,
): Promise<SlidingWindowResult> {
  try {
    const key = `${prefix}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - windowSeconds;

    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();
    const requestCount = (results?.[2]?.[1] as number) || 0;

    return {
      allowed: requestCount <= limit,
      remaining: Math.max(0, limit - requestCount),
      resetAt: now + windowSeconds,
    };
  } catch (error) {
    // Varsayılan fail-open (kullanıcı deneyimi), ama ücretli dış API/queue
    // tetikleyen rotalar fail-closed kullanır; Redis kesintisi maliyet korumasını
    // sessizce kaldırmamalı.
    console.warn("Rate limit check failed:", error);
    if (options?.failClosed) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: Math.floor(Date.now() / 1000) + windowSeconds,
      };
    }
    return { allowed: true, remaining: limit, resetAt: 0 };
  }
}

// ============================================
// Preset Rate Limit Configs
// ============================================

export const RATE_LIMITS = {
  api: { limit: 60, window: 60, prefix: "rl:api" },
  productAdd: { limit: 10, window: 60, prefix: "rl:add" },
  bulkImport: { limit: 3, window: 300, prefix: "rl:bulk", failClosed: true },
  // Checkout sayfası her açılışta bir oturum oluşturur — plan kıyaslayan meşru
  // bir kullanıcı 5 dakikada 5'ten fazla sayfa görüntüleyebilir; limit satın
  // almayı bloklamayacak kadar geniş, kötüye kullanımı kesecek kadar dar olmalı.
  checkout: { limit: 10, window: 300, prefix: "rl:checkout", failClosed: true },
  refresh: { limit: 10, window: 300, prefix: "rl:refresh" },
  auth: { limit: 10, window: 900, prefix: "rl:auth" },
};
