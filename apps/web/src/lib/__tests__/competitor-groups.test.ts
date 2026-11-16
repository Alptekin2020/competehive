import { assessCompetitorList, type CompetitorAssessment } from "@competehive/shared";
import { describe, expect, it } from "vitest";

import {
  chartHiddenCompetitorIds,
  chartHiddenHistoryFlags,
  competitorFreshness,
  countCompetitors,
  currentCompetitors,
  decisionCandidates,
  describePriceGap,
  groupCompetitors,
  type GroupableCompetitor,
} from "../competitor-groups";
import { buildPriceEvents, toInsightInput } from "../product-insights";

const NOW = new Date("2026-11-16T12:00:00Z");
const FRESH = "2026-11-16T09:00:00Z";
const OWN_PRICE = 17563.08; // Philips EP3347/90 (Trendyol)

// Sahibinin vakası: Philips EP3347/90 için gerçekte EP3341/50 olan Google kartı.
const PENDING_EP3341: GroupableCompetitor = {
  id: "pending-ep3341",
  currentPrice: "47181.75",
  matchScore: 60,
  lastScrapedAt: "2026-11-15T04:00:00Z",
  review: "pending",
};
const TRUSTED_A: GroupableCompetitor = {
  id: "trusted-a",
  currentPrice: "17299.00",
  matchScore: 92,
  lastScrapedAt: FRESH,
};
const TRUSTED_B: GroupableCompetitor = {
  id: "trusted-b",
  currentPrice: "18100.00",
  matchScore: 88,
  lastScrapedAt: FRESH,
};
const LOW_SCORE: GroupableCompetitor = {
  id: "low-score",
  currentPrice: "17900.00",
  matchScore: 45,
  lastScrapedAt: FRESH,
};
const STALE: GroupableCompetitor = {
  id: "stale",
  currentPrice: "17000.00",
  matchScore: 90,
  lastScrapedAt: "2026-11-10T12:00:00Z",
};
const DORMANT: GroupableCompetitor = {
  id: "dormant",
  currentPrice: "16000.00",
  matchScore: 85,
  lastScrapedAt: "2026-09-01T12:00:00Z",
};

const ALL = [PENDING_EP3341, TRUSTED_A, TRUSTED_B, LOW_SCORE, STALE, DORMANT];

function assess(list: GroupableCompetitor[]): Map<string, CompetitorAssessment> {
  const decision = decisionCandidates(list);
  const result = assessCompetitorList(decision.inputs, { ownPrice: OWN_PRICE, now: NOW });
  const map = new Map<string, CompetitorAssessment>();
  decision.competitors.forEach((c, i) => map.set(c.id, result[i]));
  return map;
}

describe("decisionCandidates", () => {
  it("onay bekleyen kayıtları karar girdilerine hiç vermez", () => {
    const decision = decisionCandidates(ALL);
    expect(decision.competitors.map((c) => c.id)).not.toContain("pending-ep3341");
    expect(decision.inputs).toHaveLength(ALL.length - 1);
  });

  it("yüksek skorlu bile olsa pending kayıt kullanılabilir sayılmaz", () => {
    const sneaky = { ...PENDING_EP3341, matchScore: 95, currentPrice: "17500" };
    expect(assess([sneaky, TRUSTED_A]).has(sneaky.id)).toBe(false);
  });
});

describe("groupCompetitors", () => {
  it("üç gruba ayırır; pending numaralı listeye asla girmez", () => {
    const groups = groupCompetitors(ALL, assess(ALL), { now: NOW });
    expect(groups.trusted.map((c) => c.id)).toEqual(["trusted-a", "trusted-b"]);
    expect(groups.pending.map((c) => c.id)).toEqual(["pending-ep3341"]);
    expect(groups.other.map((c) => c.id)).toEqual(["low-score", "stale"]);
    expect(groups.dormantCount).toBe(1);
  });

  it("uykudaki kayıtları yalnızca showDormant açıkken 'Diğer'e ekler", () => {
    const groups = groupCompetitors(ALL, assess(ALL), { now: NOW, showDormant: true });
    expect(groups.other.map((c) => c.id)).toContain("dormant");
    expect(groups.trusted.map((c) => c.id)).not.toContain("dormant");
  });

  it("girdinin sırasını korur", () => {
    const reversed = [TRUSTED_B, TRUSTED_A];
    expect(
      groupCompetitors(reversed, assess(reversed), { now: NOW }).trusted.map((c) => c.id),
    ).toEqual(["trusted-b", "trusted-a"]);
  });
});

describe("countCompetitors", () => {
  it("rakip sayısı onay bekleyen ve uykudaki kayıtları saymaz", () => {
    expect(countCompetitors(ALL, NOW)).toEqual({ current: 4, pending: 1, dormant: 1 });
    expect(currentCompetitors(ALL, NOW).map((c) => c.id)).toEqual([
      "trusted-a",
      "trusted-b",
      "low-score",
      "stale",
    ]);
  });

  it("yalnızca onay bekleyen varsa güncel rakip sıfırdır", () => {
    expect(countCompetitors([PENDING_EP3341], NOW).current).toBe(0);
  });
});

describe("describePriceGap", () => {
  it("2,7 katlık farkı nötr dille yazar ve büyük fark sayar", () => {
    const gap = describePriceGap(47181.75, OWN_PRICE);
    expect(gap?.text).toBe("Fiyat farkı 2,7 kat");
    expect(gap?.isLarge).toBe(true);
    expect(gap?.text).not.toMatch(/[+−-]/);
  });

  it("küçük farklarda yüzde ve yön yazar", () => {
    expect(describePriceGap(120, 100)).toMatchObject({ text: "%20 daha pahalı", isLarge: false });
    expect(describePriceGap(95, 100)).toMatchObject({ text: "%5 daha ucuz", isLarge: false });
    expect(describePriceGap(100, 100)?.text).toBe("Aynı fiyat");
  });

  it("%50'yi aşan farkta (iki yönde de) ek onay ister", () => {
    expect(describePriceGap(160, 100)).toMatchObject({ text: "%60 daha pahalı", isLarge: true });
    expect(describePriceGap(60, 100)?.isLarge).toBe(true);
    expect(describePriceGap(150, 100)?.isLarge).toBe(false);
    expect(describePriceGap(40, 100)?.text).toBe("Fiyat farkı 2,5 kat");
  });

  it("fiyat yoksa null döner", () => {
    expect(describePriceGap(null, 100)).toBeNull();
    expect(describePriceGap(100, null)).toBeNull();
    expect(describePriceGap(0, 100)).toBeNull();
  });
});

describe("competitorFreshness", () => {
  it("tek etiket üretir; 32 saatlik veri '1 gün önce' + sarı tondur", () => {
    expect(competitorFreshness("2026-11-15T04:00:00Z", NOW)).toMatchObject({
      label: "1 gün önce",
      tone: "aging",
    });
  });

  it("taze ve eski verileri ayırır", () => {
    expect(competitorFreshness(FRESH, NOW)).toMatchObject({ label: "3 sa önce", tone: "fresh" });
    expect(competitorFreshness("2026-11-16T11:55:00Z", NOW)?.label).toBe("5 dk önce");
    expect(competitorFreshness("2026-11-10T12:00:00Z", NOW)).toMatchObject({
      label: "6 gün önce",
      tone: "stale",
    });
    expect(competitorFreshness(null, NOW)).toBeNull();
  });
});

describe("grafik görünürlüğü", () => {
  it("onay bekleyen ve uykudaki rakipleri gizler", () => {
    expect([...chartHiddenCompetitorIds(ALL, NOW)].sort()).toEqual(["dormant", "pending-ep3341"]);
  });

  it("gizli rakibin price_history satırını işaretler, kendi satırı asla", () => {
    const at = new Date("2026-11-15T04:00:00Z");
    const shared = new Date("2026-11-15T06:00:00Z");
    const rows = [
      { price: "47181.75", scrapedAt: at }, // pending rakibin ikizi
      { price: "17563.08", scrapedAt: at }, // kendi fiyat
      { price: "17299.00", scrapedAt: shared }, // hem gizli hem görünür rakibin ikizi
      { price: "17299.00", scrapedAt: new Date("2026-11-15T07:00:00Z") }, // ikizsiz
    ];
    const points = [
      { competitorId: "pending-ep3341", price: 47181.75, scrapedAt: at },
      { competitorId: "pending-ep3341", price: 17563.08, scrapedAt: at },
      { competitorId: "pending-ep3341", price: 17299, scrapedAt: shared },
      { competitorId: "trusted-a", price: 17299, scrapedAt: shared },
    ];
    expect(
      chartHiddenHistoryFlags(
        rows,
        [false, true, false, false],
        points,
        new Set(["pending-ep3341"]),
      ),
    ).toEqual([true, false, false, false]);
    expect(chartHiddenHistoryFlags(rows, [false, true, false, false], points, new Set())).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("buildPriceEvents gizli rakipler için olay üretmez", () => {
    const events = buildPriceEvents({
      windowStart: new Date("2026-11-01T00:00:00Z"),
      ownHistory: [],
      competitors: [
        { id: "pending-ep3341", name: "Philips Series 3300", createdAt: "2026-11-15T04:00:00Z" },
        { id: "trusted-a", name: "Philips EP3347/90", createdAt: "2026-11-14T04:00:00Z" },
      ],
      competitorStock: [
        { competitorId: "pending-ep3341", scrapedAt: "2026-11-15T04:00:00Z", inStock: true },
        { competitorId: "pending-ep3341", scrapedAt: "2026-11-15T10:00:00Z", inStock: false },
      ],
      hiddenCompetitorIds: new Set(["pending-ep3341"]),
    });
    expect(events.map((e) => e.label)).toEqual(["Yeni rakip: Philips EP3347/90"]);
  });
});

describe("toInsightInput", () => {
  it("onay bekleyen rakipleri karar girdisinden çıkarır", () => {
    const input = toInsightInput({
      id: "p1",
      product_name: "Philips EP3347/90",
      current_price: OWN_PRICE,
      last_scraped_at: FRESH,
      competitors: [
        { current_price: "47181.75", match_score: 60, last_scraped_at: FRESH, review: "pending" },
        { current_price: "17299", match_score: 92, last_scraped_at: FRESH, review: null },
      ],
    });
    expect(input.competitors.map((c) => c.price)).toEqual([17299]);
  });
});
