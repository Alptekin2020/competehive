import { describe, it, expect } from "vitest";
import { shouldAcceptRefreshedPrice } from "../jobs/competitor-price-refresh";

describe("shouldAcceptRefreshedPrice", () => {
  it("accepts a normal price move within sanity bounds", () => {
    expect(shouldAcceptRefreshedPrice(2400, 2200, 2500)).toBe(true);
    expect(shouldAcceptRefreshedPrice(2400, 2600, 2500)).toBe(true);
  });

  it("accepts the first price when there is no previous value", () => {
    expect(shouldAcceptRefreshedPrice(null, 2400, 2500)).toBe(true);
  });

  it("rejects zero/invalid prices", () => {
    expect(shouldAcceptRefreshedPrice(2400, 0, 2500)).toBe(false);
    expect(shouldAcceptRefreshedPrice(2400, NaN, 2500)).toBe(false);
    expect(shouldAcceptRefreshedPrice(2400, -5, 2500)).toBe(false);
  });

  it("rejects >90% jumps vs the previous price (parse-error signal)", () => {
    // 2400 → 120: %95 düşüş, büyük olasılıkla taksit/yanlış alan parse edildi.
    expect(shouldAcceptRefreshedPrice(2400, 120, 2500)).toBe(false);
    expect(shouldAcceptRefreshedPrice(100, 5000, null)).toBe(false);
  });

  it("rejects prices far outside the own-price band even without a previous price", () => {
    // İlk fiyat ama kendi fiyatın 0.2x–5x bandının çok dışında — saçma parse.
    expect(shouldAcceptRefreshedPrice(null, 11, 2500)).toBe(false);
    expect(shouldAcceptRefreshedPrice(null, 20000, 2500)).toBe(false);
  });

  it("allows generous-but-plausible deviation from own price", () => {
    // 0.2x–5x bandı içinde: meşru agresif fiyat farkına izin verilir.
    expect(shouldAcceptRefreshedPrice(null, 600, 2500)).toBe(true);
    expect(shouldAcceptRefreshedPrice(null, 9000, 2500)).toBe(true);
  });

  it("skips the own-price band check when own price is unknown", () => {
    expect(shouldAcceptRefreshedPrice(null, 11, null)).toBe(true);
    expect(shouldAcceptRefreshedPrice(10, 12, null)).toBe(true);
  });
});
