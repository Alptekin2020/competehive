// Pure, side-effect-free alert-rule evaluation so the core "does this alert
// fire?" logic can be unit-tested in isolation (the worker layer only gathers
// the context and performs the I/O).

export interface AlertEvalContext {
  /** The tracked product's current price (the freshly scraped value). */
  currentPrice: number;
  /** currentPrice - previousPrice, or null when there is no comparable prior price. */
  priceChange: number | null;
  /** Percentage change vs the previous price, or null. */
  priceChangePct: number | null;
  /** Whether this evaluation was triggered by a price change. */
  isPriceEvent: boolean;
  /** Whether this evaluation was triggered by a stock change. */
  isStockEvent: boolean;
  /** Whether this evaluation was triggered by competitor price updates. */
  isCompetitorPriceEvent: boolean;
  /**
   * Number of competitor price moves that cleared the noise floors for the
   * rule being evaluated (see filterSignificantCompetitorMoves). Drives
   * COMPETITOR_PRICE_CHANGE.
   */
  significantCompetitorMoveCount: number;
  /** Current stock state of the tracked product. */
  inStock: boolean;
  /** Previous stock state, or null when unknown. */
  previousStockState: boolean | null;
  /** AlertRule.thresholdValue coerced to a number, or null. */
  thresholdValue: number | null;
  /** AlertRule.direction ("above" | "below"), threshold rules only. */
  direction: string | null;
  /** Cheapest in-stock competitor price for the product, or null when none. */
  minCompetitorPrice: number | null;
  /**
   * Current profit margin % = (currentPrice - cost) / currentPrice * 100, or
   * null when the product has no cost set. Drives LOW_MARGIN.
   */
  marginPct: number | null;
  /**
   * User-level global noise floor (User.alertThresholdPct). A price-movement
   * alert whose absolute % change is below this is suppressed. 0 disables it.
   */
  userThresholdPct: number;
}

// Rule types driven purely by the magnitude/direction of a price move. The
// user-level alertThresholdPct acts as a global noise floor on exactly these:
// a move smaller than the user's threshold produces no alert. Deliberately
// excluded — PRICE_THRESHOLD (an explicit target price; a small move across the
// target still matters), COMPETITOR_CHEAPER / COMPETITOR_PRICE_CHANGE (driven
// by a competitor's price, not our own delta — the competitor rule applies the
// same floor per-move in filterSignificantCompetitorMoves) and the stock rules
// (no price delta at all).
export const PRICE_MOVEMENT_RULE_TYPES = new Set([
  "PRICE_DROP",
  "PRICE_INCREASE",
  "PERCENTAGE_CHANGE",
]);

/**
 * Aynı fiyat değişimi için birden fazla fiyat-hareketi kuralı (PRICE_DROP /
 * PRICE_INCREASE / PERCENTAGE_CHANGE) tetiklenebilir — kullanıcıya aynı olay
 * "%5,2 arttı" ve "Fiyat arttı" diye İKİ ayrı mesajla gitmesin. Koşulu sağlayan
 * fiyat-hareketi kuralları arasından TEK kazanan seçilir; diğerleri o olay için
 * bastırılır. PERCENTAGE_CHANGE tercih edilir (kullanıcının bilinçli kurduğu
 * eşiği taşır), yoksa ilk tetiklenen kural kazanır.
 */
export function pickPriceMovementWinner<T extends { ruleType: string }>(firedRules: T[]): T | null {
  const movement = firedRules.filter((r) => PRICE_MOVEMENT_RULE_TYPES.has(r.ruleType));
  if (movement.length === 0) return null;
  return movement.find((r) => r.ruleType === "PERCENTAGE_CHANGE") ?? movement[0];
}

// ============================================
// Rakip fiyat hareketi (COMPETITOR_PRICE_CHANGE)
// ============================================

export interface CompetitorPriceMove {
  /** Bildirimde gösterilecek rakip adı; null olabilir (legacy/isimsiz kayıt). */
  competitorName: string | null;
  previousPrice: number;
  currentPrice: number;
}

/**
 * Rakip fiyat hareketlerinden yalnızca ANLAMLI olanları bırakır: geçersiz
 * fiyatlar elenir ve mutlak % değişim, kullanıcı gürültü tabanı
 * (alertThresholdPct) ile kuralın kendi eşiğinin (thresholdValue, opsiyonel)
 * BÜYÜĞÜNÜ aşmak zorundadır. Serper/scrape kaynaklı küçük fiyat oynamaları
 * böylece spam üretmez.
 */
export function filterSignificantCompetitorMoves<T extends CompetitorPriceMove>(
  moves: T[],
  opts: { userThresholdPct: number; ruleThresholdPct: number | null },
): T[] {
  const floor = Math.max(opts.userThresholdPct || 0, opts.ruleThresholdPct ?? 0);
  return moves.filter((move) => {
    const { previousPrice, currentPrice } = move;
    if (!Number.isFinite(previousPrice) || previousPrice <= 0) return false;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
    if (currentPrice === previousPrice) return false;
    const changePct = Math.abs(((currentPrice - previousPrice) / previousPrice) * 100);
    return changePct >= floor;
  });
}

/**
 * Kendi fiyatına (mutlak farkla) EN YAKIN rakibi seçer — kendi fiyat hareketi
 * bildirimlerindeki "yeni fiyatınla rakibe göre neredesin" bağlamı için.
 * Geçersiz fiyatlar (<=0, NaN) elenir; eşit uzaklıkta UCUZ olan kazanır
 * (fiyatlandırma kararı için daha temkinli referans). Aday yoksa null döner.
 */
export function pickNearestCompetitor<T extends { price: number }>(
  competitors: T[],
  ownPrice: number,
): T | null {
  if (!Number.isFinite(ownPrice) || ownPrice <= 0) return null;
  let best: T | null = null;
  for (const c of competitors) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    if (best === null) {
      best = c;
      continue;
    }
    const dist = Math.abs(c.price - ownPrice);
    const bestDist = Math.abs(best.price - ownPrice);
    if (dist < bestDist || (dist === bestDist && c.price < best.price)) best = c;
  }
  return best;
}

/**
 * Decide whether a single alert rule should fire for the given context.
 * Returns true only when the rule's condition is met; cooldown handling and
 * notification delivery stay in the worker.
 */
export function evaluateAlertRule(ruleType: string, ctx: AlertEvalContext): boolean {
  // Global user noise floor: suppress sub-threshold price moves before the
  // per-rule logic runs. Orthogonal to each rule's own thresholdValue — a change
  // must clear both the rule threshold and this user floor to fire.
  if (
    PRICE_MOVEMENT_RULE_TYPES.has(ruleType) &&
    ctx.priceChangePct !== null &&
    Math.abs(ctx.priceChangePct) < ctx.userThresholdPct
  ) {
    return false;
  }

  switch (ruleType) {
    case "PRICE_DROP":
      return ctx.isPriceEvent && ctx.priceChange !== null && ctx.priceChange < 0;

    case "PRICE_INCREASE":
      return ctx.isPriceEvent && ctx.priceChange !== null && ctx.priceChange > 0;

    case "PRICE_THRESHOLD":
      if (!ctx.isPriceEvent || ctx.thresholdValue === null) return false;
      return ctx.direction === "below"
        ? ctx.currentPrice <= ctx.thresholdValue
        : ctx.currentPrice >= ctx.thresholdValue;

    case "PERCENTAGE_CHANGE":
      if (!ctx.isPriceEvent || ctx.priceChangePct === null || ctx.thresholdValue === null) {
        return false;
      }
      return Math.abs(ctx.priceChangePct) >= ctx.thresholdValue;

    case "OUT_OF_STOCK":
      if (!ctx.isStockEvent || ctx.previousStockState === null) return false;
      return ctx.previousStockState && !ctx.inStock;

    case "BACK_IN_STOCK":
      if (!ctx.isStockEvent || ctx.previousStockState === null) return false;
      return !ctx.previousStockState && ctx.inStock;

    case "COMPETITOR_CHEAPER":
      // Fires whenever a tracked competitor is cheaper than our current price.
      if (ctx.minCompetitorPrice === null || ctx.currentPrice <= 0) return false;
      return ctx.minCompetitorPrice < ctx.currentPrice;

    case "COMPETITOR_PRICE_CHANGE":
      // Yön fark etmeksizin, gürültü tabanlarını aşan en az bir rakip fiyat
      // hareketi varsa tetiklenir. Anlamlılık filtresi kural bazında worker'da
      // uygulanır (filterSignificantCompetitorMoves) — sayısı ctx'e gelir.
      return ctx.isCompetitorPriceEvent && ctx.significantCompetitorMoveCount > 0;

    case "LOW_MARGIN":
      // Maliyeti girilmiş ürünlerde, fiyat değişimi sonrası kâr marjı kullanıcının
      // belirlediği taban yüzdesinin (thresholdValue) altına düştüğünde tetiklenir.
      // Zarar (negatif marj) her zaman tabanın altındadır → kapsanır. Maliyet yoksa
      // (marginPct === null) sessiz kalır — yanlış uyarı üretmez.
      if (!ctx.isPriceEvent || ctx.marginPct === null || ctx.thresholdValue === null) {
        return false;
      }
      return ctx.marginPct < ctx.thresholdValue;

    default:
      return false;
  }
}

// ============================================
// Global (hesap geneli) kural çözümleme
// ============================================

export interface ResolvableRule {
  trackedProductId: string | null;
  ruleType: string;
  isActive: boolean;
}

/**
 * Bir ürün için değerlendirilecek kural kümesini çözer.
 *
 * Kurallar iki seviyede yaşar:
 *   - Ürün kuralı  (trackedProductId = ürün): yalnızca o ürün için geçerli.
 *   - Genel kural  (trackedProductId = null): kullanıcının TÜM ürünleri için
 *     geçerli — 100 ürünü olan satıcı 100 ayrı kural kurmak zorunda kalmaz.
 *
 * Öncelik: aynı ruleType için ürün kuralı genel kuralı EZER. Ürün kuralı
 * pasifse bile ezer — böylece kullanıcı tek ürünü "sessize alabilir"
 * (genel kural açıkken o üründe o tür bildirimi kapatmak için pasif bir
 * ürün kuralı yeterlidir).
 *
 * Dönen liste yalnızca aktif kuralları içerir.
 */
export function resolveApplicableRules<T extends ResolvableRule>(
  rules: T[],
  productId: string,
): T[] {
  const productRules = rules.filter((r) => r.trackedProductId === productId);
  const overriddenTypes = new Set(productRules.map((r) => r.ruleType));

  return [
    ...productRules.filter((r) => r.isActive),
    ...rules.filter(
      (r) => r.trackedProductId === null && r.isActive && !overriddenTypes.has(r.ruleType),
    ),
  ];
}
