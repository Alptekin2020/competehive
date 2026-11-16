import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, scraperFn } = vi.hoisted(() => ({
  prismaMock: {
    competitor: {
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    competitorPrice: { create: vi.fn(async () => ({})) },
    priceHistory: { create: vi.fn(async () => ({})) },
  },
  scraperFn: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../jobs/processor", () => ({ alertQueue: { add: vi.fn(async () => ({})) } }));
vi.mock("../scrapers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scrapers")>();
  return { ...actual, getScraper: () => scraperFn };
});

import { processCompetitorScrapeJob } from "../jobs/competitor-scrape";
import { createListingGoneError, ScraperError } from "../scrapers";
import {
  DEAD_AFTER_FAILURES,
  hasScrapeFailureMarks,
  readScrapeHealth,
  withScrapeFailure,
  withScrapeSuccess,
} from "../utils/dead-listing";
import { assessCompetitor, readCompetitorDeadAt } from "../utils/competitor-quality";

const now = new Date("2026-11-16T03:26:00Z");
const DEAD_HB = "https://www.hepsiburada.com/grohe-eurosmart-lavabo-bataryasi-pm-HBC00009O3GJA";

describe("dead-listing marks", () => {
  it("marks LISTING_GONE immediately and keeps the other attributes", () => {
    const next = withScrapeFailure({ review: "confirmed" }, { gone: true, reason: "gone" }, now);
    expect(next.review).toBe("confirmed");
    expect(readScrapeHealth(next)).toEqual({
      deadAt: now.toISOString(),
      deadReason: "gone",
      scrapeFailures: 1,
      lastAttemptAt: now.toISOString(),
    });
  });

  it("marks dead only after consecutive ordinary failures", () => {
    let attrs: Record<string, unknown> = {};
    for (let i = 1; i < DEAD_AFTER_FAILURES; i++) {
      attrs = withScrapeFailure(attrs, { gone: false, reason: "timeout" }, now);
      expect(readScrapeHealth(attrs).deadAt).toBeNull();
    }
    attrs = withScrapeFailure(attrs, { gone: false, reason: "timeout" }, now);
    expect(readScrapeHealth(attrs).deadAt).toBe(now.toISOString());
    expect(readScrapeHealth(attrs).scrapeFailures).toBe(DEAD_AFTER_FAILURES);
  });

  it("keeps the first deadAt on later failures and clears everything on success", () => {
    const first = withScrapeFailure({}, { gone: true, reason: "gone" }, now);
    const later = withScrapeFailure(first, { gone: true, reason: "gone" }, new Date("2026-11-23"));
    expect(readScrapeHealth(later).deadAt).toBe(now.toISOString());
    const cleared = withScrapeSuccess({ ...later, seller: "Teknosa" });
    expect(hasScrapeFailureMarks(cleared)).toBe(false);
    expect(cleared.seller).toBe("Teknosa");
  });

  it("excludes dead rows from decisions in the quality policy", () => {
    const fresh = { price: 17000, matchScore: 90, lastScrapedAt: now };
    expect(assessCompetitor(fresh, { now }).usable).toBe(true);
    const dead = assessCompetitor(
      { ...fresh, deadAt: readCompetitorDeadAt({ deadAt: now.toISOString() }) },
      { now },
    );
    expect(dead.usable).toBe(false);
    expect(dead.issues).toContain("dead");
    expect(readCompetitorDeadAt({ deadAt: "not a date" })).toBeNull();
    expect(readCompetitorDeadAt(null)).toBeNull();
  });
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "530da1cf",
    competitorUrl: DEAD_HB,
    marketplace: "HEPSIBURADA",
    competitorName: "Grohe Eurosmart Lavabo Bataryası",
    trackedProductId: "p1",
    currentPrice: 2499,
    matchScore: 88,
    matchAttributes: {},
    trackedProduct: { currentPrice: 2600, status: "ACTIVE", productName: "Grohe Eurosmart" },
    ...overrides,
  };
}

function writtenAttributes(): Record<string, unknown> {
  const calls = prismaMock.competitor.update.mock.calls as unknown as Array<
    [{ data: { matchAttributes?: Record<string, unknown> } }]
  >;
  const last = calls[calls.length - 1];
  return last[0].data.matchAttributes ?? {};
}

describe("processCompetitorScrapeJob failure handling", () => {
  beforeEach(() => {
    prismaMock.competitor.findUnique.mockReset();
    prismaMock.competitor.update.mockClear();
    prismaMock.competitor.delete.mockClear();
    scraperFn.mockReset();
  });

  it("marks a priced automated row dead on LISTING_GONE without throwing", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(row());
    scraperFn.mockRejectedValue(createListingGoneError(DEAD_HB, "redirected:…-c-18021949"));
    await expect(processCompetitorScrapeJob({ competitorId: "530da1cf" })).resolves.toEqual({
      success: false,
    });
    expect(prismaMock.competitor.delete).not.toHaveBeenCalled();
    const attrs = writtenAttributes();
    expect(readScrapeHealth(attrs).deadAt).not.toBeNull();
    expect(attrs.deadReason).toBe("listing-gone");
  });

  it("marks a manual (unscored, never priced) row but never deletes it", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(
      row({ matchScore: null, currentPrice: null, matchAttributes: null }),
    );
    scraperFn.mockRejectedValue(createListingGoneError(DEAD_HB, "http-404"));
    await processCompetitorScrapeJob({ competitorId: "530da1cf" });
    expect(prismaMock.competitor.delete).not.toHaveBeenCalled();
    expect(readScrapeHealth(writtenAttributes()).deadAt).not.toBeNull();
  });

  it("marks a confirmed row but never deletes it", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(
      row({ matchScore: 100, currentPrice: null, matchAttributes: { review: "confirmed" } }),
    );
    scraperFn.mockRejectedValue(createListingGoneError(DEAD_HB, "http-410"));
    await processCompetitorScrapeJob({ competitorId: "530da1cf" });
    expect(prismaMock.competitor.delete).not.toHaveBeenCalled();
    expect(writtenAttributes().review).toBe("confirmed");
  });

  it("still deletes a never-priced automated discovery row (dropIfUnpriced)", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(row({ currentPrice: null }));
    scraperFn.mockRejectedValue(createListingGoneError(DEAD_HB, "http-404"));
    await processCompetitorScrapeJob({ competitorId: "530da1cf" });
    expect(prismaMock.competitor.delete).toHaveBeenCalledTimes(1);
  });

  it("counts ordinary failures, rethrows, and marks dead on the third", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(
      row({ matchAttributes: { scrapeFailures: 2 } }),
    );
    scraperFn.mockRejectedValue(
      new ScraperError("Hepsiburada urun bilgileri cekilemedi", {
        code: "SCRAPE_ALL_METHODS_FAILED",
      }),
    );
    await expect(processCompetitorScrapeJob({ competitorId: "530da1cf" })).rejects.toThrow();
    const health = readScrapeHealth(writtenAttributes());
    expect(health.scrapeFailures).toBe(3);
    expect(health.deadAt).not.toBeNull();
  });

  it("clears the dead mark when a fresh price is read", async () => {
    prismaMock.competitor.findUnique.mockResolvedValue(
      row({ matchAttributes: { deadAt: now.toISOString(), deadReason: "x", scrapeFailures: 3 } }),
    );
    scraperFn.mockResolvedValue({
      name: "Grohe Eurosmart Lavabo Bataryası",
      price: 2450,
      currency: "TRY",
      inStock: true,
    });
    await expect(processCompetitorScrapeJob({ competitorId: "530da1cf" })).resolves.toMatchObject({
      success: true,
    });
    expect(hasScrapeFailureMarks(writtenAttributes())).toBe(false);
  });
});
