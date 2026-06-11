import { describe, it, expect } from "vitest";
import {
  evaluateAlertRule,
  resolveApplicableRules,
  type AlertEvalContext,
  type ResolvableRule,
} from "../jobs/alert-rules";

const base: AlertEvalContext = {
  currentPrice: 100,
  priceChange: null,
  priceChangePct: null,
  isPriceEvent: false,
  isStockEvent: false,
  inStock: true,
  previousStockState: null,
  thresholdValue: null,
  direction: null,
  minCompetitorPrice: null,
  userThresholdPct: 0,
};

describe("evaluateAlertRule", () => {
  describe("PRICE_DROP", () => {
    it("fires when price dropped on a price event", () => {
      expect(
        evaluateAlertRule("PRICE_DROP", { ...base, isPriceEvent: true, priceChange: -10 }),
      ).toBe(true);
    });
    it("does not fire when price rose", () => {
      expect(
        evaluateAlertRule("PRICE_DROP", { ...base, isPriceEvent: true, priceChange: 10 }),
      ).toBe(false);
    });
    it("does not fire without a price event or with null change", () => {
      expect(evaluateAlertRule("PRICE_DROP", { ...base, priceChange: -10 })).toBe(false);
      expect(
        evaluateAlertRule("PRICE_DROP", { ...base, isPriceEvent: true, priceChange: null }),
      ).toBe(false);
    });
  });

  describe("PRICE_INCREASE", () => {
    it("fires when price rose on a price event", () => {
      expect(
        evaluateAlertRule("PRICE_INCREASE", { ...base, isPriceEvent: true, priceChange: 5 }),
      ).toBe(true);
    });
    it("does not fire on a drop", () => {
      expect(
        evaluateAlertRule("PRICE_INCREASE", { ...base, isPriceEvent: true, priceChange: -5 }),
      ).toBe(false);
    });
  });

  describe("PRICE_THRESHOLD", () => {
    it("fires below threshold when direction is below", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        currentPrice: 90,
        thresholdValue: 100,
        direction: "below",
      };
      expect(evaluateAlertRule("PRICE_THRESHOLD", ctx)).toBe(true);
    });
    it("fires above threshold when direction is above", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        currentPrice: 110,
        thresholdValue: 100,
        direction: "above",
      };
      expect(evaluateAlertRule("PRICE_THRESHOLD", ctx)).toBe(true);
    });
    it("does not fire when threshold not crossed", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        currentPrice: 110,
        thresholdValue: 100,
        direction: "below",
      };
      expect(evaluateAlertRule("PRICE_THRESHOLD", ctx)).toBe(false);
    });
    it("does not fire without a threshold value", () => {
      expect(
        evaluateAlertRule("PRICE_THRESHOLD", { ...base, isPriceEvent: true, currentPrice: 90 }),
      ).toBe(false);
    });
  });

  describe("PERCENTAGE_CHANGE", () => {
    it("fires when abs pct change meets threshold", () => {
      const ctx = { ...base, isPriceEvent: true, priceChangePct: -12, thresholdValue: 10 };
      expect(evaluateAlertRule("PERCENTAGE_CHANGE", ctx)).toBe(true);
    });
    it("does not fire below threshold", () => {
      const ctx = { ...base, isPriceEvent: true, priceChangePct: 4, thresholdValue: 10 };
      expect(evaluateAlertRule("PERCENTAGE_CHANGE", ctx)).toBe(false);
    });
  });

  describe("OUT_OF_STOCK", () => {
    it("fires when going from in stock to out of stock", () => {
      const ctx = { ...base, isStockEvent: true, previousStockState: true, inStock: false };
      expect(evaluateAlertRule("OUT_OF_STOCK", ctx)).toBe(true);
    });
    it("does not fire when previous stock state is unknown", () => {
      const ctx = { ...base, isStockEvent: true, previousStockState: null, inStock: false };
      expect(evaluateAlertRule("OUT_OF_STOCK", ctx)).toBe(false);
    });
  });

  describe("BACK_IN_STOCK", () => {
    it("fires when going from out of stock to in stock", () => {
      const ctx = { ...base, isStockEvent: true, previousStockState: false, inStock: true };
      expect(evaluateAlertRule("BACK_IN_STOCK", ctx)).toBe(true);
    });
    it("does not fire when it was already in stock", () => {
      const ctx = { ...base, isStockEvent: true, previousStockState: true, inStock: true };
      expect(evaluateAlertRule("BACK_IN_STOCK", ctx)).toBe(false);
    });
  });

  describe("COMPETITOR_CHEAPER", () => {
    it("fires when a competitor is cheaper than our price", () => {
      const ctx = { ...base, currentPrice: 100, minCompetitorPrice: 80 };
      expect(evaluateAlertRule("COMPETITOR_CHEAPER", ctx)).toBe(true);
    });
    it("does not fire when no competitor is cheaper", () => {
      const ctx = { ...base, currentPrice: 100, minCompetitorPrice: 120 };
      expect(evaluateAlertRule("COMPETITOR_CHEAPER", ctx)).toBe(false);
    });
    it("does not fire without competitor data or with no own price", () => {
      expect(evaluateAlertRule("COMPETITOR_CHEAPER", { ...base, minCompetitorPrice: null })).toBe(
        false,
      );
      expect(
        evaluateAlertRule("COMPETITOR_CHEAPER", {
          ...base,
          currentPrice: 0,
          minCompetitorPrice: 50,
        }),
      ).toBe(false);
    });
  });

  describe("user alertThresholdPct floor", () => {
    it("suppresses a PRICE_DROP whose abs % change is below the user threshold", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        priceChange: -2,
        priceChangePct: -2,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("PRICE_DROP", ctx)).toBe(false);
    });

    it("fires a PRICE_DROP whose abs % change meets the user threshold", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        priceChange: -6,
        priceChangePct: -6,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("PRICE_DROP", ctx)).toBe(true);
    });

    it("suppresses a PRICE_INCREASE below the user threshold", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        priceChange: 3,
        priceChangePct: 3,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("PRICE_INCREASE", ctx)).toBe(false);
    });

    it("requires a PERCENTAGE_CHANGE to clear both the rule and the user threshold", () => {
      // Rule threshold (3) is met but the user floor (5) is not → suppressed.
      const blocked = {
        ...base,
        isPriceEvent: true,
        priceChangePct: 4,
        thresholdValue: 3,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("PERCENTAGE_CHANGE", blocked)).toBe(false);

      // Clears both → fires.
      expect(evaluateAlertRule("PERCENTAGE_CHANGE", { ...blocked, priceChangePct: 6 })).toBe(true);
    });

    it("does not apply the user floor to PRICE_THRESHOLD (explicit target price)", () => {
      const ctx = {
        ...base,
        isPriceEvent: true,
        currentPrice: 90,
        priceChangePct: -1,
        thresholdValue: 100,
        direction: "below",
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("PRICE_THRESHOLD", ctx)).toBe(true);
    });

    it("does not apply the user floor to COMPETITOR_CHEAPER", () => {
      const ctx = {
        ...base,
        currentPrice: 100,
        minCompetitorPrice: 80,
        priceChangePct: -1,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("COMPETITOR_CHEAPER", ctx)).toBe(true);
    });

    it("does not apply the user floor to stock rules", () => {
      const ctx = {
        ...base,
        isStockEvent: true,
        previousStockState: true,
        inStock: false,
        priceChangePct: -1,
        userThresholdPct: 5,
      };
      expect(evaluateAlertRule("OUT_OF_STOCK", ctx)).toBe(true);
    });
  });

  it("returns false for unknown rule types", () => {
    expect(evaluateAlertRule("NONSENSE", { ...base, isPriceEvent: true, priceChange: -1 })).toBe(
      false,
    );
  });
});

// ============================================
// resolveApplicableRules — genel/ürün kural çözümleme
// ============================================

interface TestRule extends ResolvableRule {
  id: string;
}

function rule(
  id: string,
  trackedProductId: string | null,
  ruleType: string,
  isActive = true,
): TestRule {
  return { id, trackedProductId, ruleType, isActive };
}

describe("resolveApplicableRules", () => {
  const P1 = "product-1";

  it("returns active global rules when the product has no own rules", () => {
    const rules = [rule("g1", null, "PRICE_DROP"), rule("g2", null, "COMPETITOR_CHEAPER")];
    expect(resolveApplicableRules(rules, P1).map((r) => r.id)).toEqual(["g1", "g2"]);
  });

  it("returns active product rules alongside non-conflicting global rules", () => {
    const rules = [
      rule("p1", P1, "PRICE_THRESHOLD"),
      rule("g1", null, "PRICE_DROP"),
      rule("g2", null, "COMPETITOR_CHEAPER"),
    ];
    expect(resolveApplicableRules(rules, P1).map((r) => r.id)).toEqual(["p1", "g1", "g2"]);
  });

  it("lets a product rule override the global rule of the same type", () => {
    const rules = [rule("p1", P1, "PRICE_DROP"), rule("g1", null, "PRICE_DROP")];
    expect(resolveApplicableRules(rules, P1).map((r) => r.id)).toEqual(["p1"]);
  });

  it("mutes the global rule when the overriding product rule is inactive", () => {
    // Pasif ürün kuralı = o üründe o tür bildirim sessize alınmış demektir;
    // genel kural devreye GİRMEMELİ.
    const rules = [rule("p1", P1, "PRICE_DROP", false), rule("g1", null, "PRICE_DROP")];
    expect(resolveApplicableRules(rules, P1)).toEqual([]);
  });

  it("excludes inactive global rules", () => {
    const rules = [rule("g1", null, "PRICE_DROP", false), rule("g2", null, "OUT_OF_STOCK")];
    expect(resolveApplicableRules(rules, P1).map((r) => r.id)).toEqual(["g2"]);
  });

  it("ignores rules that belong to other products", () => {
    const rules = [rule("px", "product-2", "PRICE_DROP"), rule("g1", null, "PRICE_DROP")];
    expect(resolveApplicableRules(rules, P1).map((r) => r.id)).toEqual(["g1"]);
  });

  it("returns an empty list when nothing applies", () => {
    expect(resolveApplicableRules([], P1)).toEqual([]);
  });
});
