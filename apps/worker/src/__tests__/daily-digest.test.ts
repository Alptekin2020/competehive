import { describe, expect, it } from "vitest";

import {
  buildDigest,
  digestItemSummary,
  digestSubject,
  isDigestWindow,
  istanbulDateKey,
  MAX_DIGEST_ITEMS,
  type DigestCompetitorInput,
  type DigestProductInput,
} from "../utils/daily-digest";

const now = new Date("2026-11-15T06:30:00Z"); // İstanbul 09:30
const fresh = new Date(now.getTime() - 2 * 60 * 60 * 1000);

function competitor(overrides: Partial<DigestCompetitorInput> = {}): DigestCompetitorInput {
  return {
    name: "Rakip",
    marketplace: "TRENDYOL",
    price: 900,
    matchScore: 90,
    lastScrapedAt: fresh,
    priceBefore: null,
    ...overrides,
  };
}

function product(overrides: Partial<DigestProductInput> = {}): DigestProductInput {
  return { id: "p1", name: "Ürün", ownPrice: 1000, competitors: [competitor()], ...overrides };
}

const fmt = (n: number) => n.toFixed(1);

describe("digest schedule", () => {
  it("uses the Istanbul calendar day", () => {
    expect(istanbulDateKey(new Date("2026-11-14T21:30:00Z"))).toBe("2026-11-15");
    expect(istanbulDateKey(new Date("2026-11-14T20:59:00Z"))).toBe("2026-11-14");
  });

  it("only sends between 09:00 and 12:00 Istanbul time", () => {
    expect(isDigestWindow(new Date("2026-11-15T05:59:00Z"))).toBe(false);
    expect(isDigestWindow(new Date("2026-11-15T06:00:00Z"))).toBe(true);
    expect(isDigestWindow(new Date("2026-11-15T08:59:00Z"))).toBe(true);
    expect(isDigestWindow(new Date("2026-11-15T09:00:00Z"))).toBe(false);
  });
});

describe("buildDigest", () => {
  it("lists a product whose competitor is cheaper", () => {
    const digest = buildDigest([product()], now);
    expect(digest.actionableProductCount).toBe(1);
    expect(digest.undercutProductCount).toBe(1);
    expect(digest.items[0]).toMatchObject({ cheapestPrice: 900, cheaperCount: 1, gapPct: 10 });
    expect(digestSubject(digest)).toContain("1 ürününüzde rakip daha ucuz");
  });

  it("stays quiet when nothing needs attention", () => {
    const digest = buildDigest([product({ competitors: [competitor({ price: 1200 })] })], now);
    expect(digest.actionableProductCount).toBe(0);
    expect(digest.trackedProductCount).toBe(1);
  });

  it("reports price moves even when we are still the cheapest", () => {
    const digest = buildDigest(
      [product({ competitors: [competitor({ price: 1100, priceBefore: 1300 })] })],
      now,
    );
    expect(digest.items[0]).toMatchObject({ cheaperCount: 0, dropCount: 1, riseCount: 0 });
    expect(digestSubject(digest)).toContain("1 fiyat değişikliği");
    expect(digestItemSummary(digest.items[0], fmt)).toContain("en ucuz sizsiniz");
  });

  it("ignores pending candidates, stale, out-of-band and priceless competitors", () => {
    const digest = buildDigest(
      [
        product({
          competitors: [
            competitor({ matchScore: 60 }),
            competitor({ lastScrapedAt: new Date(now.getTime() - 80 * 60 * 60 * 1000) }),
            competitor({ price: 100 }),
            competitor({ price: null }),
          ],
        }),
        product({ id: "p2", ownPrice: null }),
      ],
      now,
    );
    expect(digest.trackedProductCount).toBe(0);
    expect(digest.actionableProductCount).toBe(0);
  });

  it("puts the largest gap first and caps the list", () => {
    const products = Array.from({ length: MAX_DIGEST_ITEMS + 3 }, (_, i) =>
      product({ id: `p${i}`, competitors: [competitor({ price: 990 - i * 10 })] }),
    );
    const digest = buildDigest(products, now);
    expect(digest.items).toHaveLength(MAX_DIGEST_ITEMS);
    expect(digest.actionableProductCount).toBe(MAX_DIGEST_ITEMS + 3);
    expect(digest.items[0].productId).toBe(`p${MAX_DIGEST_ITEMS + 2}`);
  });
});
