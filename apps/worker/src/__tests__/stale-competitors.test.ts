import { describe, expect, it } from "vitest";

import {
  detectCompetitorMove,
  MAX_DIRECT_SCRAPES_PER_URL,
  pickStaleCompetitorsForDirectScrape,
  type KnownCompetitorSnapshot,
} from "../utils/stale-competitors";

const now = new Date("2026-11-14T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

function competitor(overrides: Partial<KnownCompetitorSnapshot> = {}): KnownCompetitorSnapshot {
  return {
    id: "c1",
    competitorName: "Rakip",
    currentPrice: 1000,
    matchScore: 90,
    marketplace: "HEPSIBURADA",
    lastScrapedAt: hoursAgo(30),
    ...overrides,
  };
}

describe("detectCompetitorMove", () => {
  it("reports a price change of a trusted competitor", () => {
    expect(detectCompetitorMove(competitor(), 900, "Yeni başlık")).toEqual({
      competitorName: "Yeni başlık",
      previousPrice: 1000,
      currentPrice: 900,
    });
  });

  it("falls back to the stored name when the result has no title", () => {
    expect(detectCompetitorMove(competitor(), 1100)?.competitorName).toBe("Rakip");
  });

  it("ignores unchanged prices and missing previous prices", () => {
    expect(detectCompetitorMove(competitor(), 1000)).toBeNull();
    expect(detectCompetitorMove(competitor({ currentPrice: null }), 900)).toBeNull();
    expect(detectCompetitorMove(competitor({ currentPrice: 0 }), 900)).toBeNull();
    expect(detectCompetitorMove(competitor(), 0)).toBeNull();
  });

  it("keeps low-score matches out of decisions but lets manual (null score) rows through", () => {
    expect(detectCompetitorMove(competitor({ matchScore: 40 }), 900)).toBeNull();
    expect(detectCompetitorMove(competitor({ matchScore: null }), 900)).not.toBeNull();
  });
});

describe("pickStaleCompetitorsForDirectScrape", () => {
  it("skips competitors already refreshed this round", () => {
    const picked = pickStaleCompetitorsForDirectScrape([competitor()], new Set(["c1"]), now);
    expect(picked).toEqual([]);
  });

  it("skips fresh competitors, untrusted matches and marketplaces without a scraper", () => {
    const picked = pickStaleCompetitorsForDirectScrape(
      [
        competitor({ id: "fresh", lastScrapedAt: hoursAgo(5) }),
        competitor({ id: "low-score", matchScore: 50 }),
        competitor({ id: "custom", marketplace: "CUSTOM" }),
        competitor({ id: "ok" }),
        competitor({ id: "never", lastScrapedAt: null }),
      ],
      new Set(),
      now,
    );
    expect(picked.map((c) => c.id)).toEqual(["never", "ok"]);
  });

  it("caps the fan-out and takes the stalest first", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      competitor({ id: `c${i}`, lastScrapedAt: hoursAgo(25 + i) }),
    );
    const picked = pickStaleCompetitorsForDirectScrape(many, new Set(), now);
    expect(picked).toHaveLength(MAX_DIRECT_SCRAPES_PER_URL);
    expect(picked.map((c) => c.id)).toEqual(["c5", "c4", "c3"]);
  });
});
