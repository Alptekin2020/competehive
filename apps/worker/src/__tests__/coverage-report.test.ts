import { describe, expect, it } from "vitest";

import { summarizeCoverage } from "../utils/coverage-report";

const now = new Date("2026-11-17T13:00:00Z");
const fresh = new Date("2026-11-17T10:00:00Z");
const stale = new Date("2026-11-12T10:00:00Z");
const google = "https://www.google.com/search?ibp=oshop&prds=catalogid:1";

function rival(price: number, overrides: Record<string, unknown> = {}) {
  return {
    competitorUrl: `https://www.trendyol.com/x/y-p-${price}`,
    price,
    matchScore: 90,
    lastScrapedAt: fresh,
    matchAttributes: { matchBasis: "model-code" } as unknown,
    ...overrides,
  };
}

describe("summarizeCoverage", () => {
  it("counts only usable rivals and lists the weakest products", () => {
    const summary = summarizeCoverage(
      [
        {
          id: "a",
          productName: "Philips EP3347/90",
          marketplace: "TRENDYOL",
          ownPrice: 100,
          competitors: [rival(98), rival(101), rival(103, { competitorUrl: google })],
        },
        {
          id: "b",
          productName: "Arzum Bakır Cezve",
          marketplace: "HEPSIBURADA",
          ownPrice: 100,
          competitors: [
            rival(99),
            rival(97, { lastScrapedAt: stale }),
            rival(95, { matchAttributes: { review: "pending" } }),
            rival(96, { matchAttributes: { deadAt: "2026-11-16T00:00:00Z" } }),
            rival(94, { matchScore: 40 }),
          ],
        },
        { id: "c", productName: "Boş", marketplace: "HEPSIBURADA", ownPrice: 50, competitors: [] },
      ],
      now,
    );
    expect(summary).toMatchObject({ products: 3, covered: 1, coveragePct: 33, zero: 1 });
    expect(summary.byMarketplace).toEqual({
      TRENDYOL: { products: 1, covered: 1 },
      HEPSIBURADA: { products: 2, covered: 0 },
    });
    expect(summary.weakest.map((r) => [r.id, r.usable, r.usableDirect, r.total])).toEqual([
      ["c", 0, 0, 0],
      ["b", 1, 1, 5],
    ]);
  });

  it("returns 0% for no products", () => {
    expect(summarizeCoverage([], now).coveragePct).toBe(0);
  });
});
