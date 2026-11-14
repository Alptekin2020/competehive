// ============================================
// Competitor discovery scheduling (own clock)
// ============================================
//
// Periodic discovery used to pick products by TrackedProduct.refreshCompletedAt
// ("not refreshed for 6h"). The 6-hour refresh-url cycle writes that same
// column for every product, so on a normal day it reset the clock right before
// discovery came due and discovery starved: new competitors were only searched
// at onboarding, and a product the matcher once left at "0 rakip" stayed there.
//
// Discovery now keeps its own last-run timestamp per product in Redis.

import { cacheGet, cacheSet } from "./cache";

export const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;

const KEY_PREFIX = "competitor-discovery:last:";
const KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

// Fallback when Redis is unavailable, so one process does not rediscover the
// same products every tick.
const memoryLastRun = new Map<string, number>();

/**
 * Pure: products whose last discovery is missing or older than the interval,
 * never-discovered first, then longest-waiting first, capped at batchSize.
 */
export function pickDueForDiscovery<T extends { id: string }>(
  products: T[],
  lastRunById: Map<string, number | null>,
  now: number,
  batchSize: number,
  intervalMs: number = DISCOVERY_INTERVAL_MS,
): T[] {
  return products
    .map((product) => ({ product, lastRun: lastRunById.get(product.id) ?? null }))
    .filter(({ lastRun }) => lastRun === null || lastRun > now || now - lastRun >= intervalMs)
    .sort((a, b) => (a.lastRun ?? 0) - (b.lastRun ?? 0))
    .slice(0, batchSize)
    .map(({ product }) => product);
}

export async function getDiscoveryLastRuns(
  productIds: string[],
): Promise<Map<string, number | null>> {
  const entries = await Promise.all(
    productIds.map(async (id): Promise<[string, number | null]> => {
      const stored = await cacheGet<number>(`${KEY_PREFIX}${id}`);
      return [id, typeof stored === "number" ? stored : (memoryLastRun.get(id) ?? null)];
    }),
  );
  return new Map(entries);
}

export async function markDiscoveryRun(productId: string, now: number = Date.now()): Promise<void> {
  memoryLastRun.set(productId, now);
  await cacheSet(`${KEY_PREFIX}${productId}`, now, KEY_TTL_SECONDS);
}
