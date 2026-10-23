/**
 * schema.org / Open Graph availability value → stock state (null = unknown).
 * Normalizes the spellings stores actually use: "https://schema.org/InStock",
 * "in stock", "in_stock", "out of stock", "OutOfStock", "sold out", ...
 *
 * Worker mirror: apps/worker/src/utils/availability.ts — keep in sync (the
 * worker's Docker build context cannot import the shared package).
 */
export function parseAvailability(value: string | null | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (/outofstock|soldout|discontinued/.test(normalized)) return false;
  if (
    /instock|limitedavailability|instoreonly|onlineonly|preorder|presale|backorder/.test(normalized)
  ) {
    return true;
  }
  return null;
}
