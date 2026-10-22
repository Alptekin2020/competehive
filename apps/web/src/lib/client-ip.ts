import type { NextRequest } from "next/server";

/**
 * Best-effort client IP for anonymous rate limiting. On Vercel the first
 * x-forwarded-for entry is the client address set by the edge.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "anonymous";
}
