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
   * User-level global noise floor (User.alertThresholdPct). A price-movement
   * alert whose absolute % change is below this is suppressed. 0 disables it.
   */
  userThresholdPct: number;
}

// Rule types driven purely by the magnitude/direction of a price move. The
// user-level alertThresholdPct acts as a global noise floor on exactly these:
// a move smaller than the user's threshold produces no alert. Deliberately
// excluded — PRICE_THRESHOLD (an explicit target price; a small move across the
// target still matters), COMPETITOR_CHEAPER (driven by a competitor's price,
// not our own delta) and the stock rules (no price delta at all).
const PRICE_MOVEMENT_RULE_TYPES = new Set(["PRICE_DROP", "PRICE_INCREASE", "PERCENTAGE_CHANGE"]);

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

    default:
      return false;
  }
}
