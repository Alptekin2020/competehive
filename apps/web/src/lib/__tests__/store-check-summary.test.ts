import { describe, it, expect } from "vitest";
import { parseSummaryDays } from "../store-check-summary";

describe("parseSummaryDays", () => {
  it("defaults to 30 days", () => {
    expect(parseSummaryDays(null)).toBe(30);
    expect(parseSummaryDays("abc")).toBe(30);
  });

  it("clamps to 1..365 and floors fractions", () => {
    expect(parseSummaryDays("0")).toBe(1);
    expect(parseSummaryDays("9999")).toBe(365);
    expect(parseSummaryDays("7.9")).toBe(7);
  });
});
