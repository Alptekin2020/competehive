import { describe, expect, it } from "vitest";

import { readMatchBasis, withinPriceBandForBasis } from "../utils/competitor-quality";
import { buildDigest, type DigestCompetitorInput } from "../utils/daily-digest";
import { needsPeerMedian, readPendingOwnPrice, resolveOwnPriceUpdate } from "../utils/price-sanity";
import { detectCompetitorMove } from "../utils/stale-competitors";

const now = new Date("2026-11-16T09:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

// ============================================
// Kendi fiyat: onay bekleyen büyük değişim (Note Cosmetics ₺299,90 → ₺674,40)
// ============================================

describe("resolveOwnPriceUpdate", () => {
  const baseMeta = { rejectedCompetitorUrls: ["https://x.test/a"] };

  it("accepts small moves immediately and leaves metadata alone", () => {
    const d = resolveOwnPriceUpdate({ previousPrice: 299.9, newPrice: 319.9, metadata: baseMeta });
    expect(d).toMatchObject({ accept: true, reason: "plausible", metadata: null });
  });

  it("accepts when there is no baseline", () => {
    expect(
      resolveOwnPriceUpdate({ previousPrice: null, newPrice: 674.4, metadata: null }),
    ).toMatchObject({ accept: true, reason: "no-baseline" });
  });

  it("holds the first big read and stores it as pendingOwnPrice", () => {
    const d = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: baseMeta,
      now,
    });
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("awaiting-confirmation");
    expect(d.metadata).toMatchObject({
      rejectedCompetitorUrls: baseMeta.rejectedCompetitorUrls,
      pendingOwnPrice: { price: 674.4, firstSeenAt: now.toISOString(), reads: 1 },
    });
  });

  it("accepts the second consistent read (±3%) and clears the pending entry", () => {
    const held = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: baseMeta,
      now: hoursAgo(24),
    });
    const second = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 679.9,
      metadata: held.metadata,
      now,
    });
    expect(second.accept).toBe(true);
    expect(second.reason).toBe("confirmed-by-repeat");
    expect(second.metadata).toEqual(baseMeta);
    expect(readPendingOwnPrice(second.metadata)).toBeNull();
  });

  it("an inconsistent second read replaces the pending value instead of accepting", () => {
    const held = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: null,
      now: hoursAgo(24),
    });
    const second = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 899,
      metadata: held.metadata,
      now,
    });
    expect(second.accept).toBe(false);
    expect(readPendingOwnPrice(second.metadata)?.price).toBe(899);
  });

  it("a pending read older than 7 days does not confirm", () => {
    const held = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: null,
      now: hoursAgo(24 * 8),
    });
    expect(
      resolveOwnPriceUpdate({ previousPrice: 299.9, newPrice: 674.4, metadata: held.metadata, now })
        .accept,
    ).toBe(false);
  });

  it("accepts immediately when the trusted competitor median confirms (0.7x–1.4x)", () => {
    const d = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: null,
      peerMedian: 650,
      now,
    });
    expect(d).toMatchObject({ accept: true, reason: "confirmed-by-peers" });
  });

  it("ignores a peer median that does not match the new price", () => {
    const d = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 674.4,
      metadata: null,
      peerMedian: 310,
      now,
    });
    expect(d.accept).toBe(false);
  });

  it("jumps outside 0.4x–2.5x need two reads even when peers agree (decimal slip)", () => {
    const d = resolveOwnPriceUpdate({
      previousPrice: 1250,
      newPrice: 12500,
      metadata: null,
      peerMedian: 12400,
      now,
    });
    expect(d.accept).toBe(false);
    expect(needsPeerMedian(1250, 12500)).toBe(true);
  });

  it("treats a drop below 0.4x as big (installment price grabbed)", () => {
    const d = resolveOwnPriceUpdate({ previousPrice: 6000, newPrice: 500, metadata: null, now });
    expect(d.accept).toBe(false);
  });

  it("clears a stale pending entry when a normal read arrives", () => {
    const d = resolveOwnPriceUpdate({
      previousPrice: 299.9,
      newPrice: 305,
      metadata: { pendingOwnPrice: { price: 674.4, firstSeenAt: now.toISOString(), reads: 1 } },
      now,
    });
    expect(d).toMatchObject({ accept: true, metadata: {} });
  });
});

// ============================================
// detectCompetitorMove: tam kalite politikası
// ============================================

describe("detectCompetitorMove quality policy", () => {
  const known = (extra: Record<string, unknown> = {}) => ({
    competitorName: "Philips Series 3300",
    currentPrice: 46000,
    matchScore: 75,
    ...extra,
  });

  it("a pending candidate never produces a move", () => {
    expect(
      detectCompetitorMove(known({ matchAttributes: { review: "pending" } }), 47181.75, null, {
        ownPrice: 46000,
      }),
    ).toBeNull();
  });

  it("a title/AI match outside 0.55x–1.8x of the own price produces no move", () => {
    expect(detectCompetitorMove(known(), 47181.75, null, { ownPrice: 17563.08 })).toBeNull();
  });

  it("a model-code match at 2.69x still moves (0.3x–3x)", () => {
    expect(
      detectCompetitorMove(
        known({ matchScore: 90, matchAttributes: { matchBasis: "model-code" } }),
        47181.75,
        null,
        { ownPrice: 17563.08 },
      ),
    ).not.toBeNull();
  });

  it("a user-confirmed row moves regardless of band", () => {
    expect(
      detectCompetitorMove(
        known({ matchScore: 100, matchAttributes: { review: "confirmed" } }),
        90000,
        null,
        { ownPrice: 17563.08 },
      ),
    ).not.toBeNull();
  });
});

// ============================================
// URL turu: bilinen satırın bant kontrolü (refresh-product-url adım 7)
// ============================================

describe("known-row band check used by the refresh-url round", () => {
  const inBand = (attrs: unknown, score: number | null, own: number | null, price: number) =>
    withinPriceBandForBasis(own, price, readMatchBasis(attrs, score));

  it("rejects the EP3341/50 Google card price on an AI-scored row", () => {
    expect(inBand({ details: "AI" }, 75, 17563.08, 47181.75)).toBe(false);
  });

  it("keeps a model-code row and a manual row inside 0.3x–3x", () => {
    expect(inBand({ details: "Ortak model kodu + marka teyidi" }, 90, 17563.08, 47181.75)).toBe(
      true,
    );
    expect(inBand(null, null, 17563.08, 47181.75)).toBe(true);
  });

  it("never rejects a confirmed row or a product without own price", () => {
    expect(inBand({ review: "confirmed" }, 100, 17563.08, 99999)).toBe(true);
    expect(inBand({ details: "AI" }, 75, null, 47181.75)).toBe(true);
  });
});

// ============================================
// Günlük özet: liste düzeyi kalite (akran aykırılığı)
// ============================================

describe("daily digest list-level quality", () => {
  const digestNow = new Date("2026-11-15T06:30:00Z");
  const fresh = new Date(digestNow.getTime() - 2 * 60 * 60 * 1000);
  const c = (price: number, extra: Partial<DigestCompetitorInput> = {}): DigestCompetitorInput => ({
    name: `Rakip ${price}`,
    marketplace: "TRENDYOL",
    price,
    matchScore: 90,
    lastScrapedAt: fresh,
    matchAttributes: { matchBasis: "model-code" },
    priceBefore: null,
    ...extra,
  });

  it("a bait listing far below its peers is not reported as the cheapest", () => {
    const digest = buildDigest(
      [
        {
          id: "p1",
          name: "Philips HD9650/90",
          ownPrice: 9475,
          competitors: [c(3000), c(9082.26), c(9499), c(9999), c(10580)],
        },
      ],
      digestNow,
    );
    expect(digest.items[0].cheapestPrice).toBe(9082.26);
    expect(digest.items[0].competitorCount).toBe(4);
  });

  it("pending rows stay out even with a high score", () => {
    const digest = buildDigest(
      [
        {
          id: "p1",
          name: "Ürün",
          ownPrice: 1000,
          competitors: [c(900, { matchAttributes: { review: "pending" } })],
        },
      ],
      digestNow,
    );
    expect(digest.trackedProductCount).toBe(0);
  });
});
