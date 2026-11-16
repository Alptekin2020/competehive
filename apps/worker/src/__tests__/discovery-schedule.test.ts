import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findUnique, update, runCompetitorDiscovery } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  runCompetitorDiscovery: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: { trackedProduct: { findMany, findUnique, update } },
}));
vi.mock("../jobs/competitor-processor", () => ({ runCompetitorDiscovery }));

import { refreshStaleCompetitorPrices } from "../jobs/competitor-price-refresh";
import {
  isDiscoveryDue,
  readDiscoveredAt,
  selectDueForDiscovery,
  withDiscoveredAt,
  type DiscoveryCandidate,
} from "../utils/discovery-schedule";

const NOW = new Date("2026-11-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const PAID = { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: null };
const FREE = { plan: "FREE", planStatus: "ACTIVE", planExpiresAt: null };

function product(
  id: string,
  opts: { discoveredAt?: Date; refreshCompletedAt?: Date | null; paid?: boolean; meta?: object },
): DiscoveryCandidate & { productName: string; productUrl: string } {
  return {
    id,
    productName: `Ürün ${id}`,
    productUrl: `https://www.trendyol.com/x-p-${id}`,
    metadata: {
      ...(opts.meta ?? {}),
      ...(opts.discoveredAt ? { discoveredAt: opts.discoveredAt.toISOString() } : {}),
    },
    refreshCompletedAt: opts.refreshCompletedAt ?? null,
    user: opts.paid === false ? FREE : PAID,
  };
}

describe("discovery schedule (own timestamp)", () => {
  it("a refresh-url run (refreshCompletedAt = now) does not delay discovery", () => {
    // Prod hatası: 6 saatlik URL turu refreshCompletedAt'i sürekli yeniliyordu.
    const p = product("a", { discoveredAt: hoursAgo(7), refreshCompletedAt: NOW });
    expect(isDiscoveryDue(p, NOW, 6)).toBe(true);
  });

  it("is not due again before the paid 6h cadence", () => {
    const p = product("a", { discoveredAt: hoursAgo(2), refreshCompletedAt: hoursAgo(30) });
    expect(isDiscoveryDue(p, NOW, 6)).toBe(false);
  });

  it("FREE plans are discovered once a day", () => {
    expect(isDiscoveryDue(product("f", { discoveredAt: hoursAgo(10), paid: false }), NOW, 6)).toBe(
      false,
    );
    expect(isDiscoveryDue(product("f", { discoveredAt: hoursAgo(25), paid: false }), NOW, 6)).toBe(
      true,
    );
  });

  it("products without discoveredAt are due; ordered by the legacy field, capped by batch", () => {
    const rows = [
      product("recent", { refreshCompletedAt: hoursAgo(1) }),
      product("old", { refreshCompletedAt: hoursAgo(40) }),
      product("never", { refreshCompletedAt: null }),
      product("fresh", { discoveredAt: hoursAgo(1) }),
    ];
    const picked = selectDueForDiscovery(rows, NOW, 6, 2).map((p) => p.id);
    expect(picked).toEqual(["never", "old"]);
  });

  it("withDiscoveredAt keeps the other metadata fields", () => {
    const meta = withDiscoveredAt({ rejectedCompetitorUrls: ["u"], brand: "Philips" }, NOW);
    expect(meta.rejectedCompetitorUrls).toEqual(["u"]);
    expect(meta.brand).toBe("Philips");
    expect(readDiscoveredAt(meta)?.toISOString()).toBe(NOW.toISOString());
    expect(readDiscoveredAt({ discoveredAt: "bozuk" })).toBeNull();
    expect(readDiscoveredAt(null)).toBeNull();
  });
});

describe("refreshStaleCompetitorPrices", () => {
  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset();
    update.mockReset();
    runCompetitorDiscovery.mockReset();
  });

  it("runs discovery for a paid product just touched by refresh-url, then stamps discoveredAt", async () => {
    findMany.mockResolvedValue([
      product("p1", {
        discoveredAt: hoursAgo(8),
        refreshCompletedAt: NOW,
        meta: { rejectedCompetitorUrls: ["x"] },
      }),
      product("p2", { discoveredAt: hoursAgo(1), refreshCompletedAt: hoursAgo(30) }),
    ]);
    runCompetitorDiscovery.mockResolvedValue({ found: 2 });
    findUnique.mockResolvedValue({ metadata: { rejectedCompetitorUrls: ["x"] } });
    update.mockResolvedValue({});

    const stats = await refreshStaleCompetitorPrices({ now: NOW });

    expect(stats).toMatchObject({ candidates: 1, processed: 1, discovered: 2 });
    expect(runCompetitorDiscovery).toHaveBeenCalledTimes(1);
    expect(runCompetitorDiscovery.mock.calls[0][0].productId).toBe("p1");
    const written = update.mock.calls[0][0].data.metadata;
    expect(written.rejectedCompetitorUrls).toEqual(["x"]);
    expect(typeof written.discoveredAt).toBe("string");
  });

  it("stamps discoveredAt even when discovery fails (no 30-min retry loop)", async () => {
    findMany.mockResolvedValue([product("p1", { refreshCompletedAt: null })]);
    runCompetitorDiscovery.mockRejectedValue(new Error("serper down"));
    findUnique.mockResolvedValue({ metadata: null });
    update.mockResolvedValue({});

    const stats = await refreshStaleCompetitorPrices({ now: NOW });
    expect(stats).toMatchObject({ failed: 1 });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
