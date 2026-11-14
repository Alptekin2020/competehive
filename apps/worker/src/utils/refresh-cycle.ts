// ============================================
// 6-hour refresh cycle bookkeeping (deploy-safe)
// ============================================
//
// The cycle's last run time lives in Redis so a deploy/restart does not reset
// the clock. Falls back to in-process memory when Redis is unavailable.

import { cacheGet, cacheSet } from "./cache";

export const REFRESH_CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const REFRESH_CYCLE_CHECK_MS = 10 * 60 * 1000;

const LAST_RUN_KEY = "refresh-url:last-run";
const LAST_RUN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Pure: is a new cycle due, given the last run timestamp (ms) and now (ms)? */
export function isRefreshCycleDue(
  lastRunAt: number | null | undefined,
  now: number,
  intervalMs: number = REFRESH_CYCLE_INTERVAL_MS,
): boolean {
  if (typeof lastRunAt !== "number" || !Number.isFinite(lastRunAt) || lastRunAt <= 0) return true;
  // A timestamp from the future (clock skew) must not block the cycle forever.
  if (lastRunAt > now) return true;
  return now - lastRunAt >= intervalMs;
}

let memoryLastRunAt: number | null = null;

/**
 * Returns true (and records "now" as the last run) when a cycle is due.
 * The caller then enqueues the cycle's jobs.
 */
export async function claimRefreshCycle(now: number = Date.now()): Promise<boolean> {
  const stored = await cacheGet<number>(LAST_RUN_KEY);
  const lastRunAt = typeof stored === "number" ? stored : memoryLastRunAt;
  if (!isRefreshCycleDue(lastRunAt, now)) return false;
  memoryLastRunAt = now;
  await cacheSet(LAST_RUN_KEY, now, LAST_RUN_TTL_SECONDS);
  return true;
}
