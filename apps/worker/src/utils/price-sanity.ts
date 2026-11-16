// Shared price-sanity guard. A single scrape that reports a price wildly
// different from the last known one is almost always a parsing error (grabbing
// an installment/unit price, a decimal-separator slip, etc.) rather than a real
// move. Writing it would emit a false alert and — on the URL-deduped refresh
// path — fan the bad value out to every sibling product. We reject changes
// larger than this threshold for a single read; resolveOwnPriceUpdate (below)
// accepts such a change once a second read confirms it or the market does.
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

// ============================================
// Kendi fiyat güncelleme kararı (onay bekleyen büyük değişim)
// ============================================
//
// isPlausiblePriceChange tek başına büyük bir değişimi SONSUZA KADAR engeller:
// her tarama yine eski fiyata göre kıyaslanır ve gerçek bir fiyat değişimi asla
// yazılmaz (prod: Note Cosmetics ₺299,90 → ₺674,40, +%125; ürün haftalarca eski
// fiyatta kaldı). Çözüm: büyük değişim ilk görüldüğünde metadata.pendingOwnPrice
// olarak saklanır ve
//   - sonraki bir okuma aynı fiyatı (±%3) tekrar görürse kabul edilir, ya da
//   - yeni fiyat güvenilir rakip medyanının 0.7x–1.4x'i içindeyse (piyasa yeni
//     fiyatı doğruluyor) ve değişim 0.4x–2.5x sınırları içindeyse hemen kabul
//     edilir. Bu sınırların dışındaki sıçramalar (ondalık kayması, taksit
//     fiyatı) piyasa doğrulasa bile iki okuma ister.
// Büyük değişim: isPlausiblePriceChange'i geçemeyen VEYA 0.4x'in altına düşen
// fiyat (taksit/birim fiyatı yakalama hatası tipik olarak böyle görünür).

export const OWN_PRICE_CONFIRM_TOLERANCE = 0.03;
export const OWN_PRICE_PEER_MIN_RATIO = 0.7;
export const OWN_PRICE_PEER_MAX_RATIO = 1.4;
export const OWN_PRICE_FAST_PATH_MIN_CHANGE = 0.4;
export const OWN_PRICE_FAST_PATH_MAX_CHANGE = 2.5;
/** Bundan eski bekleyen okuma onay için sayılmaz; yeni bekleyen olarak başlar. */
export const OWN_PRICE_PENDING_MAX_AGE_DAYS = 7;

export interface PendingOwnPrice {
  price: number;
  firstSeenAt: string;
  reads: number;
}

export type OwnPriceDecisionReason =
  | "no-baseline"
  | "plausible"
  | "confirmed-by-repeat"
  | "confirmed-by-peers"
  | "awaiting-confirmation";

export interface OwnPriceDecision {
  accept: boolean;
  reason: OwnPriceDecisionReason;
  /**
   * Yazılması gereken yeni metadata (pendingOwnPrice eklenmiş ya da temizlenmiş);
   * null = metadata değişmez.
   */
  metadata: Record<string, unknown> | null;
  /** Bekleyen okuma (hold durumunda). */
  pending: PendingOwnPrice | null;
}

export interface OwnPriceUpdateInput {
  previousPrice: number | null | undefined;
  newPrice: number | null | undefined;
  /** Ürünün mevcut metadata JSON'u. */
  metadata: unknown;
  /** Güvenilir rakip medyanı (kendi fiyattan bağımsız); yoksa null. */
  peerMedian?: number | null;
  now?: Date;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function readPendingOwnPrice(metadata: unknown): PendingOwnPrice | null {
  const raw = asObject(metadata).pendingOwnPrice;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const price = typeof obj.price === "number" ? obj.price : Number(obj.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const firstSeenAt = typeof obj.firstSeenAt === "string" ? obj.firstSeenAt : "";
  const reads = typeof obj.reads === "number" && obj.reads > 0 ? obj.reads : 1;
  return { price, firstSeenAt, reads };
}

/** Değişim, onay gerektirecek kadar büyük mü? */
export function isBigOwnPriceChange(previousPrice: number, newPrice: number): boolean {
  if (!isPlausiblePriceChange(previousPrice, newPrice)) return true;
  return newPrice / previousPrice < OWN_PRICE_FAST_PATH_MIN_CHANGE;
}

/** Bekleyen büyük değişimin piyasa doğrulamasıyla hemen kabul edilmesine izin var mı? */
export function needsPeerMedian(
  previousPrice: number | null | undefined,
  newPrice: number | null | undefined,
): boolean {
  if (!previousPrice || previousPrice <= 0 || !newPrice || newPrice <= 0) return false;
  return isBigOwnPriceChange(previousPrice, newPrice);
}

/**
 * Kendi fiyat okumasının yazılıp yazılmayacağına karar verir. Saf fonksiyon:
 * çağıran `accept` ise fiyatı yazar, her durumda `metadata` null değilse onu
 * da yazar.
 */
export function resolveOwnPriceUpdate(input: OwnPriceUpdateInput): OwnPriceDecision {
  const now = input.now ?? new Date();
  const { previousPrice, newPrice } = input;
  const existingPending = readPendingOwnPrice(input.metadata);
  const cleared = (): Record<string, unknown> | null => {
    if (!existingPending) return null;
    const next = asObject(input.metadata);
    delete next.pendingOwnPrice;
    return next;
  };

  if (!previousPrice || previousPrice <= 0 || !newPrice || newPrice <= 0) {
    return { accept: true, reason: "no-baseline", metadata: cleared(), pending: null };
  }
  if (!isBigOwnPriceChange(previousPrice, newPrice)) {
    return { accept: true, reason: "plausible", metadata: cleared(), pending: null };
  }

  const pendingAgeMs = existingPending?.firstSeenAt
    ? now.getTime() - new Date(existingPending.firstSeenAt).getTime()
    : Number.NaN;
  const pendingFresh =
    existingPending !== null &&
    Number.isFinite(pendingAgeMs) &&
    pendingAgeMs <= OWN_PRICE_PENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (
    existingPending &&
    pendingFresh &&
    Math.abs(newPrice / existingPending.price - 1) <= OWN_PRICE_CONFIRM_TOLERANCE
  ) {
    return { accept: true, reason: "confirmed-by-repeat", metadata: cleared(), pending: null };
  }

  const changeRatio = newPrice / previousPrice;
  const peerMedian = input.peerMedian;
  if (
    typeof peerMedian === "number" &&
    Number.isFinite(peerMedian) &&
    peerMedian > 0 &&
    changeRatio >= OWN_PRICE_FAST_PATH_MIN_CHANGE &&
    changeRatio <= OWN_PRICE_FAST_PATH_MAX_CHANGE &&
    newPrice >= peerMedian * OWN_PRICE_PEER_MIN_RATIO &&
    newPrice <= peerMedian * OWN_PRICE_PEER_MAX_RATIO
  ) {
    return { accept: true, reason: "confirmed-by-peers", metadata: cleared(), pending: null };
  }

  const pending: PendingOwnPrice = { price: newPrice, firstSeenAt: now.toISOString(), reads: 1 };
  const next = asObject(input.metadata);
  next.pendingOwnPrice = pending;
  return { accept: false, reason: "awaiting-confirmation", metadata: next, pending };
}
