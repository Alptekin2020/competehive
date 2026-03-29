import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "./rate-limit";

interface RateLimitConfig {
  limit: number;
  window: number;
  prefix: string;
}

/**
 * Apply rate limiting to an API route handler.
 * Returns a NextResponse with 429 if rate limited, or null if allowed.
 */
export async function applyRateLimit(
  req: NextRequest,
  userId: string | null,
  config: RateLimitConfig,
): Promise<NextResponse | null> {
  const identifier =
    userId || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";

  const result = await checkRateLimit(identifier, config.limit, config.window, config.prefix);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.",
        retryAfter: result.resetAt - Math.floor(Date.now() / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.resetAt - Math.floor(Date.now() / 1000)),
          "X-RateLimit-Limit": String(config.limit),
          "X-RateLimit-Remaining": String(result.remaining),
          "X-RateLimit-Reset": String(result.resetAt),
        },
      },
    );
  }

  return null;
}
