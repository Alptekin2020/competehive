import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const scrape = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    competitor: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
      delete: (...args: unknown[]) => remove(...args),
    },
    competitorPrice: { create: vi.fn() },
    priceHistory: { create: vi.fn() },
  },
}));
vi.mock("../scrapers", () => ({ getScraper: () => scrape }));
vi.mock("../jobs/processor", () => ({ alertQueue: { add: vi.fn() } }));

import { shouldPurgeCompetitor } from "../jobs/competitor-cleanup";
import { processCompetitorScrapeJob } from "../jobs/competitor-scrape";
import { pickDirectListing } from "../utils/direct-listing";

const OWN_TITLE = "Philips EP3347/90 3300 Serisi Tam Otomatik Espresso Makinesi";
const OWN_URL =
  "https://www.trendyol.com/philips/ep3347-90-tam-otomatik-espresso-makinesi-p-795891055";
const GOOGLE_CARD =
  "https://www.google.com/search?ibp=oshop&q=philips+series+3300&prds=catalogid:123,pvo:1";

describe("pickDirectListing — model identity guard", () => {
  it("never links a page with a different model code", () => {
    expect(
      pickDirectListing(
        OWN_TITLE,
        "Philips Series 3300 tam otomatik espresso makinesi",
        [
          {
            title: "Philips 3300 Serisi Tam Otomatik Espresso Makinesi",
            link: "https://www.hepsiburada.com/philips-ep3341-50-3300-serisi-p-HBCV0000AB12",
          },
        ],
        OWN_URL,
      ),
    ).toBeNull();
  });

  it("does not link a page that cannot confirm the source code", () => {
    expect(
      pickDirectListing("Philips Airfryer XXL HD9650/90 Fritöz", "Philips Airfryer XXL Fritöz", [
        {
          title: "Philips Airfryer XXL Fritöz",
          link: "https://www.trendyol.com/philips/airfryer-xxl-fritoz-p-1",
        },
      ]),
    ).toBeNull();
  });

  it("links the page with the same code read from the slug", () => {
    expect(
      pickDirectListing(
        OWN_TITLE,
        "",
        [
          {
            title: "Philips 3300 Serisi Tam Otomatik Espresso Makinesi",
            link: "https://www.trendyol.com/philips/ep3347-90-3300-serisi-p-2",
          },
        ],
        OWN_URL,
      )?.link,
    ).toContain("ep3347-90");
  });
});

describe("shouldPurgeCompetitor — model identity", () => {
  const context = { productName: OWN_TITLE, ownPrice: 17563, productUrl: OWN_URL };

  it("purges an automated row with a conflicting code", () => {
    expect(
      shouldPurgeCompetitor(
        {
          competitorName: "Philips EP3341/50 3300 Serisi Espresso",
          competitorPrice: 18000,
          matchScore: 75,
          competitorUrl: "https://www.n11.com/urun/philips-ep3341-50-123",
          matchAttributes: {},
        },
        context,
      ),
    ).toBe("model-code-conflict");
  });

  it("never purges confirmed or manual rows", () => {
    const row = {
      competitorName: "Philips EP3341/50 3300 Serisi Espresso",
      competitorPrice: 18000,
      competitorUrl: "https://www.n11.com/urun/philips-ep3341-50-123",
    };
    expect(
      shouldPurgeCompetitor(
        { ...row, matchScore: 100, matchAttributes: { review: "confirmed" } },
        context,
      ),
    ).toBeNull();
    expect(shouldPurgeCompetitor({ ...row, matchScore: null }, context)).toBeNull();
  });

  it("purges a pending Google card whose code can never be verified (owner case)", () => {
    expect(
      shouldPurgeCompetitor(
        {
          competitorName:
            "Philips Series 3300 tam otomatik espresso makinesi 6 sıcak ve buzlu içecek",
          competitorPrice: 47181.75,
          matchScore: 60,
          competitorUrl: GOOGLE_CARD,
          matchAttributes: { review: "pending" },
        },
        { ...context, ownPrice: 17563.08 },
      ),
    ).toBe("unverifiable-model");
  });

  it("keeps a row with the same code", () => {
    expect(
      shouldPurgeCompetitor(
        {
          competitorName: "Philips EP3347/90 LatteGo",
          competitorPrice: 18000,
          matchScore: 90,
          competitorUrl: "https://www.n11.com/urun/philips-ep3347-90-123",
          matchAttributes: {},
        },
        context,
      ),
    ).toBeNull();
  });
});

describe("processCompetitorScrapeJob — page title model check", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset().mockResolvedValue({});
    remove.mockReset().mockResolvedValue({});
    scrape.mockReset();
  });

  const row = (overrides: Record<string, unknown>) => ({
    id: "c1",
    competitorUrl: "https://www.trendyol.com/philips/espresso-makinesi-p-55",
    marketplace: "TRENDYOL",
    competitorName: "Philips 3300 Serisi Espresso Makinesi",
    trackedProductId: "p1",
    currentPrice: null,
    matchScore: 75,
    matchAttributes: {},
    trackedProduct: {
      currentPrice: 17563,
      status: "ACTIVE",
      productName: OWN_TITLE,
      productUrl: OWN_URL,
    },
    ...overrides,
  });

  it("drops a never-priced automated row whose page shows another model", async () => {
    findUnique.mockResolvedValue(row({}));
    scrape.mockResolvedValue({ price: 18000, name: "Philips EP3341/50 3300 Serisi Espresso" });
    const result = await processCompetitorScrapeJob({ competitorId: "c1" });
    expect(result.success).toBe(false);
    expect(remove).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("downgrades a priced automated row instead of writing the price", async () => {
    findUnique.mockResolvedValue(row({ currentPrice: 17900 }));
    scrape.mockResolvedValue({ price: 18000, name: "Philips EP3341/50 3300 Serisi Espresso" });
    const result = await processCompetitorScrapeJob({ competitorId: "c1" });
    expect(result.success).toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchScore: 30 }) }),
    );
  });

  it("leaves manual rows alone", async () => {
    findUnique.mockResolvedValue(row({ matchScore: null }));
    scrape.mockResolvedValue({ price: 18000, name: "Philips EP3341/50 3300 Serisi Espresso" });
    const result = await processCompetitorScrapeJob({ competitorId: "c1" });
    expect(result.success).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
