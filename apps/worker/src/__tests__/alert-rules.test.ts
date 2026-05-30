import { describe, it, expect } from "vitest";
import { evaluateAlertRule, type AlertEvalContext } from "../jobs/alert-rules";

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

  it("returns false for unknown rule types", () => {
    expect(evaluateAlertRule("NONSENSE", { ...base, isPriceEvent: true, priceChange: -1 })).toBe(
      false,
    );
  });
});
