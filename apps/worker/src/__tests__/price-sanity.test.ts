import { describe, it, expect } from "vitest";
import { isPlausiblePriceChange, MAX_PRICE_CHANGE_PCT } from "../utils/price-sanity";

describe("isPlausiblePriceChange", () => {
  it("accepts when there is no usable baseline (first scrape / zero / null)", () => {
    expect(isPlausiblePriceChange(null, 100)).toBe(true);
    expect(isPlausiblePriceChange(0, 100)).toBe(true);
    expect(isPlausiblePriceChange(undefined, 100)).toBe(true);
  });

  it("accepts a non-positive new price (handled by callers' price>0 checks)", () => {
    expect(isPlausiblePriceChange(100, 0)).toBe(true);
    expect(isPlausiblePriceChange(100, null)).toBe(true);
  });

  it("accepts moderate moves within the threshold", () => {
    expect(isPlausiblePriceChange(100, 150)).toBe(true); // +50%
    expect(isPlausiblePriceChange(100, 55)).toBe(true); // -45%
    expect(isPlausiblePriceChange(100, 10)).toBe(true); // -90% exactly
    expect(isPlausiblePriceChange(100, 190)).toBe(true); // +90% exactly
  });

  it("rejects order-of-magnitude jumps (likely parse errors)", () => {
    expect(isPlausiblePriceChange(1250, 1.25)).toBe(false); // decimal slip
    expect(isPlausiblePriceChange(1.25, 1250)).toBe(false); // inverse slip
    expect(isPlausiblePriceChange(100, 5)).toBe(false); // -95%
    expect(isPlausiblePriceChange(100, 1000)).toBe(false); // +900%
  });

  it("uses a 90% threshold", () => {
    expect(MAX_PRICE_CHANGE_PCT).toBe(90);
    expect(isPlausiblePriceChange(100, 9.99)).toBe(false); // just over -90%
  });
});
