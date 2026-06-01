// Shared price-sanity guard. A single scrape that reports a price wildly
// different from the last known one is almost always a parsing error (grabbing
// an installment/unit price, a decimal-separator slip, etc.) rather than a real
// move. Writing it would emit a false alert and — on the URL-deduped refresh
// path — fan the bad value out to every sibling product. We reject changes
// larger than this threshold; genuine large discounts above it are rare enough
// that one skipped cycle (until the next scrape confirms) is the safer trade.
export const MAX_PRICE_CHANGE_PCT = 90;

/**
 * Returns false when `newPrice` is an implausible jump from `previousPrice`
 * (> MAX_PRICE_CHANGE_PCT in either direction). When there is no usable
 * baseline (first scrape, or non-positive prices) there is nothing to compare,
 * so it returns true and lets the caller's existing `price > 0` checks apply.
 */
export function isPlausiblePriceChange(
  previousPrice: number | null | undefined,
  newPrice: number | null | undefined,
): boolean {
  if (!previousPrice || previousPrice <= 0) return true;
  if (!newPrice || newPrice <= 0) return true;
  const changePct = Math.abs((newPrice - previousPrice) / previousPrice) * 100;
  return changePct <= MAX_PRICE_CHANGE_PCT;
}
