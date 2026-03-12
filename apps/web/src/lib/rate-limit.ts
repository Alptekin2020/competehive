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
): Promise<RateLimitResult> {
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
