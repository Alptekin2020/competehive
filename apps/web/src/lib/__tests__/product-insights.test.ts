import { describe, it, expect } from "vitest";
import {
  buildPriceEvents,
  computeNextCheckAt,
  computeProductInsight,
  findOpportunity,
  formatNextCheck,
  type InsightProductInput,
} from "../product-insights";

const NOW = new Date("2026-11-14T12:00:00Z");
const fresh = "2026-11-14T11:00:00Z";

function product(overrides: Partial<InsightProductInput> = {}): InsightProductInput {
  return {
    id: "p1",
    name: "Air Fryer",
    currentPrice: 1000,
    cost: null,
    status: "ACTIVE",
    lastSuccessAt: fresh,
    lastScrapedAt: fresh,
    scrapeInterval: 720,
    competitors: [],
    ...overrides,
  };
}

const comp = (price: number, extra: Record<string, unknown> = {}) => ({
  price,
  matchScore: 90,
  lastScrapedAt: fresh,
  ...extra,
});

describe("computeProductInsight", () => {
  it("returns no-data without valid competitors", () => {
    const insight = computeProductInsight(product(), NOW);
    expect(insight.position).toBe("no-data");
    expect(insight.positionPct).toBeNull();
  });

  it("detects cheapest, middle and most expensive", () => {
    expect(
      computeProductInsight(product({ competitors: [comp(1100), comp(1200)] }), NOW).position,
    ).toBe("cheapest");
    const middle = computeProductInsight(product({ competitors: [comp(900), comp(1200)] }), NOW);
    expect(middle.position).toBe("middle");
    expect(middle.rank).toBe(2);
    expect(middle.positionPct).toBeCloseTo(33.33, 1);
    const top = computeProductInsight(product({ competitors: [comp(900), comp(950)] }), NOW);
    expect(top.position).toBe("most-expensive");
    expect(top.cheaperCount).toBe(2);
    expect(top.gapToCheapestPct).toBeCloseTo(11.11, 1);
  });

  it("ignores competitors that fail the quality policy", () => {
    const insight = computeProductInsight(
      product({ competitors: [comp(500, { matchScore: 20 }), comp(1100)] }),
      NOW,
    );
    expect(insight.validCompetitorCount).toBe(1);
    expect(insight.position).toBe("cheapest");
  });

  it("flags stale and never-scraped products", () => {
    expect(computeProductInsight(product({ lastSuccessAt: null }), NOW).neverScraped).toBe(true);
    expect(
      computeProductInsight(product({ lastSuccessAt: "2026-11-12T10:00:00Z" }), NOW).isStale,
    ).toBe(true);
  });
});

describe("computeNextCheckAt", () => {
  it("adds the scrape interval to the last attempt", () => {
    expect(computeNextCheckAt("2026-11-14T11:00:00Z", 720, "ACTIVE", NOW)?.toISOString()).toBe(
      "2026-11-14T23:00:00.000Z",
    );
  });

  it("waits at least a day for ERROR products and never for PAUSED", () => {
    expect(computeNextCheckAt("2026-11-14T11:00:00Z", 60, "ERROR", NOW)?.toISOString()).toBe(
      "2026-11-15T11:00:00.000Z",
    );
    expect(computeNextCheckAt(fresh, 60, "PAUSED", NOW)).toBeNull();
  });

  it("returns now when overdue or never scraped", () => {
    expect(computeNextCheckAt("2026-11-10T00:00:00Z", 60, "ACTIVE", NOW)).toEqual(NOW);
    expect(computeNextCheckAt(null, 60, "ACTIVE", NOW)).toEqual(NOW);
  });
});

describe("formatNextCheck", () => {
  it("describes soon, today and tomorrow", () => {
    const local = new Date(2026, 10, 14, 12, 0);
    expect(formatNextCheck(local, local)).toBe("birazdan");
    expect(formatNextCheck(new Date(2026, 10, 14, 18, 0), local)).toBe("bugün 18:00");
    expect(formatNextCheck(new Date(2026, 10, 15, 9, 30), local)).toBe("yarın 09:30");
    expect(formatNextCheck(null, local)).toBe("duraklatıldı");
  });
});

describe("findOpportunity", () => {
  const run = (input: InsightProductInput) =>
    findOpportunity(input, computeProductInsight(input, NOW));

  it("suggests undercutting when the gap is small", () => {
    const op = run(product({ competitors: [comp(980), comp(1200)] }));
    expect(op?.kind).toBe("undercut");
    expect(op?.suggestedPrice).toBe(979);
  });

  it("does not undercut below the margin floor", () => {
    expect(run(product({ cost: 900, competitors: [comp(980)] }))).toBeNull();
  });

  it("suggests raising when cheapest with headroom", () => {
    const op = run(product({ competitors: [comp(1200), comp(1300)] }));
    expect(op?.kind).toBe("raise");
    expect(op?.suggestedPrice).toBe(1199);
  });

  it("ignores invalid competitors for the raise target", () => {
    // 1050 has a low match score, so the next valid rival is 1200.
    const op = run(product({ competitors: [comp(1050, { matchScore: 10 }), comp(1200)] }));
    expect(op?.suggestedPrice).toBe(1199);
  });

  it("prioritizes loss and competitor stock-outs", () => {
    expect(run(product({ cost: 1100, competitors: [comp(1200)] }))?.kind).toBe("loss");
    expect(run(product({ competitors: [comp(1200, { inStock: false })] }))?.kind).toBe(
      "competitor-out-of-stock",
    );
  });

  it("returns nothing for a large gap", () => {
    expect(run(product({ competitors: [comp(700)] }))).toBeNull();
  });
});

describe("buildPriceEvents", () => {
  it("collects own changes, new competitors and stock-outs in order", () => {
    const events = buildPriceEvents({
      windowStart: new Date("2026-11-01T00:00:00Z"),
      ownHistory: [
        { scrapedAt: "2026-11-02T10:00:00Z", price: 1000, priceChange: null, priceChangePct: null },
        { scrapedAt: "2026-11-05T10:00:00Z", price: 1100, priceChange: 100, priceChangePct: 10 },
      ],
      competitors: [
        { id: "c1", name: "TeknoEv", createdAt: "2026-11-03T10:00:00Z" },
        { id: "c2", name: "Eski", createdAt: "2026-10-01T10:00:00Z" },
      ],
      competitorStock: [
        { competitorId: "c2", scrapedAt: "2026-11-06T10:00:00Z", inStock: true },
        { competitorId: "c2", scrapedAt: "2026-11-07T10:00:00Z", inStock: false },
        { competitorId: "c2", scrapedAt: "2026-11-08T10:00:00Z", inStock: false },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual([
      "competitor-added",
      "own-price-change",
      "competitor-out-of-stock",
    ]);
    expect(events[1].label).toContain("artırıldı");
    expect(events[2].label).toBe("Eski: stok bitti");
  });
});
