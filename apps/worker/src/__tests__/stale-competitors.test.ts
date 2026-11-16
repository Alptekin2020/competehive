import { describe, expect, it } from "vitest";

import {
  countStaleTrustedCompetitors,
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

describe("pickStaleCompetitorsForDirectScrape dead and recently attempted rows", () => {
  // Prod 530da1cf: ölü Hepsiburada `-pm-` ilanı 6 turun 6'sında slot aldı.
  const deadRow = (deadHoursAgo: number, lastAttemptHoursAgo?: number) =>
    competitor({
      id: "530da1cf",
      lastScrapedAt: hoursAgo(200),
      matchAttributes: {
        deadAt: hoursAgo(deadHoursAgo).toISOString(),
        deadReason: "listing-gone",
        ...(lastAttemptHoursAgo !== undefined
          ? { lastAttemptAt: hoursAgo(lastAttemptHoursAgo).toISOString() }
          : {}),
      },
    });

  it("skips a row marked dead within the last 7 days, even if it is the stalest", () => {
    const picked = pickStaleCompetitorsForDirectScrape(
      [deadRow(6, 6), competitor({ id: "alive", lastScrapedAt: hoursAgo(30) })],
      new Set(),
      now,
    );
    expect(picked.map((c) => c.id)).toEqual(["alive"]);
  });

  it("re-probes a dead row 7 days after its last attempt", () => {
    expect(pickStaleCompetitorsForDirectScrape([deadRow(8 * 24)], new Set(), now)).toHaveLength(1);
    // Başarısız yeniden yoklama: 7 gün daha dinlenir.
    expect(pickStaleCompetitorsForDirectScrape([deadRow(8 * 24, 2)], new Set(), now)).toEqual([]);
  });

  it("skips rows attempted (and failed) in the last 24 hours", () => {
    const recent = competitor({
      lastScrapedAt: hoursAgo(50),
      matchAttributes: { scrapeFailures: 1, lastAttemptAt: hoursAgo(5).toISOString() },
    });
    const old = competitor({
      id: "c2",
      lastScrapedAt: hoursAgo(50),
      matchAttributes: { scrapeFailures: 1, lastAttemptAt: hoursAgo(30).toISOString() },
    });
    expect(
      pickStaleCompetitorsForDirectScrape([recent, old], new Set(), now).map((c) => c.id),
    ).toEqual(["c2"]);
  });
});

describe("countStaleTrustedCompetitors", () => {
  it("counts trusted rows older than 72h that were not updated this round", () => {
    const counts = countStaleTrustedCompetitors(
      [
        competitor({ id: "fresh", lastScrapedAt: hoursAgo(10) }),
        competitor({ id: "updated", lastScrapedAt: hoursAgo(100) }),
        competitor({
          id: "google",
          lastScrapedAt: hoursAgo(100),
          competitorUrl: "https://www.google.com/search?ibp=oshop&prds=pid:123",
        }),
        competitor({
          id: "dead",
          lastScrapedAt: hoursAgo(100),
          matchAttributes: { deadAt: hoursAgo(20).toISOString() },
        }),
        competitor({ id: "low", matchScore: 40, lastScrapedAt: hoursAgo(100) }),
        competitor({ id: "never", matchScore: null, lastScrapedAt: null }),
      ],
      new Set(["updated"]),
      now,
    );
    expect(counts).toEqual({ stale: 3, googleHosted: 1, dead: 1, trusted: 5 });
  });
});
