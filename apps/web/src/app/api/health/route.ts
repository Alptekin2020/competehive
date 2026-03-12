import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = {
    db: false,
    redis: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    // DB connection failed
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    // Redis connection failed
  }

  const allHealthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { status: allHealthy ? "ok" : "degraded", ...checks },
    { status: allHealthy ? 200 : 503 },
  );
}
