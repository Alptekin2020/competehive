import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const checks: Record<string, { status: "ok" | "error"; latencyMs?: number; error?: string }> = {};
  const startTime = Date.now();

  // 1. Database health check
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    checks.database = { status: "error", error: message };
  }

  // 2. Redis health check
  try {
    const redisStart = Date.now();
    await redis.ping();
    checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    checks.redis = { status: "error", error: message };
  }

  // 3. Overall status
  const allHealthy = Object.values(checks).every((c) => c.status === "ok");
  const totalLatency = Date.now() - startTime;

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalLatency,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
      checks,
    },
    { status: allHealthy ? 200 : 503 },
  );
}
