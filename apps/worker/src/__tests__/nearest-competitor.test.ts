import { describe, it, expect } from "vitest";
import { pickNearestCompetitor } from "../jobs/alert-rules";
import { resolveNearestCompetitor } from "../services/notifications";

// Kendi fiyat hareketi bildirimlerine eklenen "en yakın rakip + fark" bağlamı:
// rakip seçimi (worker) ve metin bağlamı üretimi (notifications) deterministik
// olduğundan regresyon altına alınır.
describe("pickNearestCompetitor", () => {
  const competitors = [
    { name: "Pahalı Satıcı", price: 1_500 },
    { name: "Yakın Satıcı", price: 1_300 },
    { name: "Ucuz Satıcı", price: 900 },
  ];

  it("picks the competitor with the smallest absolute price distance", () => {
    expect(pickNearestCompetitor(competitors, 1_259)?.name).toBe("Yakın Satıcı");
    expect(pickNearestCompetitor(competitors, 1_000)?.name).toBe("Ucuz Satıcı");
  });

  it("prefers the cheaper competitor on an exact distance tie", () => {
    const tied = [
      { name: "Üstteki", price: 1_100 },
      { name: "Alttaki", price: 900 },
    ];
    expect(pickNearestCompetitor(tied, 1_000)?.name).toBe("Alttaki");
  });

  it("skips invalid competitor prices", () => {
    const list = [
      { name: "Bozuk", price: 0 },
      { name: "NaN", price: Number.NaN },
      { name: "Geçerli", price: 2_000 },
    ];
    expect(pickNearestCompetitor(list, 1_000)?.name).toBe("Geçerli");
  });

  it("returns null when own price is invalid or there is no usable competitor", () => {
    expect(pickNearestCompetitor(competitors, 0)).toBeNull();
    expect(pickNearestCompetitor(competitors, Number.NaN)).toBeNull();
    expect(pickNearestCompetitor([], 1_000)).toBeNull();
    expect(pickNearestCompetitor([{ name: "Bozuk", price: -5 }], 1_000)).toBeNull();
  });
});

describe("resolveNearestCompetitor", () => {
  it("reports a more-expensive position when own price is above the competitor", () => {
    const ctx = resolveNearestCompetitor({
      currentPrice: 1_444.91,
      nearestCompetitorPrice: 1_300,
      nearestCompetitorName: "Yakın Satıcı",
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.position).toBe("more-expensive");
    expect(ctx?.diff).toBeCloseTo(144.91, 2);
    expect(ctx?.diffPct).toBeCloseTo((144.91 / 1_300) * 100, 2);
    expect(ctx?.name).toBe("Yakın Satıcı");
  });

  it("reports a cheaper position when own price is below the competitor", () => {
    const ctx = resolveNearestCompetitor({
      currentPrice: 1_259,
      nearestCompetitorPrice: 1_300,
      nearestCompetitorName: "Yakın Satıcı",
    });
    expect(ctx?.position).toBe("cheaper");
    expect(ctx?.diff).toBeCloseTo(-41, 2);
  });

  it("reports an equal position for identical prices", () => {
    const ctx = resolveNearestCompetitor({
      currentPrice: 1_300,
      nearestCompetitorPrice: 1_300,
      nearestCompetitorName: "Yakın Satıcı",
    });
    expect(ctx?.position).toBe("equal");
    expect(ctx?.diff).toBe(0);
  });

  it("falls back to a generic name for unnamed/blank competitors", () => {
    const ctx = resolveNearestCompetitor({
      currentPrice: 1_000,
      nearestCompetitorPrice: 950,
      nearestCompetitorName: "  ",
    });
    expect(ctx?.name).toBe("Rakip");
  });

  it("returns null when competitor or own price is missing/invalid", () => {
    expect(
      resolveNearestCompetitor({ currentPrice: 1_000, nearestCompetitorPrice: null }),
    ).toBeNull();
    expect(resolveNearestCompetitor({ currentPrice: 1_000 })).toBeNull();
    expect(resolveNearestCompetitor({ currentPrice: 0, nearestCompetitorPrice: 950 })).toBeNull();
    expect(
      resolveNearestCompetitor({ currentPrice: 1_000, nearestCompetitorPrice: -1 }),
    ).toBeNull();
  });
});
