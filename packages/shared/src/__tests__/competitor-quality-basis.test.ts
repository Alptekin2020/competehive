import { describe, expect, it } from "vitest";

import {
  assessCompetitor,
  assessCompetitorList,
  priceBandForBasis,
  readMatchBasis,
  TITLE_PRICE_BAND_MAX_RATIO,
  TITLE_PRICE_BAND_MIN_RATIO,
  trustedPeerMedian,
  withinPriceBandForBasis,
} from "../competitor-quality";

// Eşleşme dayanağına göre fiyat bandı, onay bekleyen aday, onaylı muafiyet ve
// kendi fiyattan bağımsız akran medyanı. Fixture: Philips EP3347/90 prod vakası
// (kendi fiyat ₺17.563,08; EP3341/50 Google kartı ₺47.181,75, AI skoru 60).

const now = new Date("2026-11-16T12:00:00Z");
const fresh = new Date("2026-11-16T09:00:00Z");
const OWN = 17563.08;
const SIBLING = 47181.75;

describe("readMatchBasis", () => {
  it("confirmed review wins over everything", () => {
    expect(readMatchBasis({ review: "confirmed", matchBasis: "title" }, 100)).toBe("confirmed");
  });

  it("reads the explicit matchBasis field", () => {
    expect(readMatchBasis({ matchBasis: "model-code" }, 90)).toBe("model-code");
    expect(readMatchBasis({ matchBasis: "title" }, 88)).toBe("title");
    expect(readMatchBasis({ matchBasis: "ai" }, 75)).toBe("title");
  });

  it("recognises legacy deterministic code accepts from their details text", () => {
    expect(readMatchBasis({ details: "Ortak benzersiz ürün kodu" }, 95)).toBe("model-code");
    expect(
      readMatchBasis({ details: "Ortak model kodu + marka teyidi; spec/adet çelişkisi yok" }, 90),
    ).toBe("model-code");
  });

  it("unknown basis on a scored row falls back to the title band", () => {
    expect(readMatchBasis({ details: "AI açıklaması" }, 85)).toBe("title");
    expect(readMatchBasis(null, 85)).toBe("title");
  });

  it("an unscored row is a manual row", () => {
    expect(readMatchBasis(null, null)).toBe("manual");
  });
});

describe("priceBandForBasis / withinPriceBandForBasis", () => {
  it("model-code and manual keep 0.3x–3x, title is 0.55x–1.8x, confirmed has no band", () => {
    expect(priceBandForBasis("model-code")).toEqual({ min: 0.3, max: 3 });
    expect(priceBandForBasis("manual")).toEqual({ min: 0.3, max: 3 });
    expect(priceBandForBasis("title")).toEqual({
      min: TITLE_PRICE_BAND_MIN_RATIO,
      max: TITLE_PRICE_BAND_MAX_RATIO,
    });
    expect(priceBandForBasis("confirmed")).toBeNull();
  });

  it("the EP3341/50 sibling (2.69x) passes a code band but not a title band", () => {
    expect(withinPriceBandForBasis(OWN, SIBLING, "model-code")).toBe(true);
    expect(withinPriceBandForBasis(OWN, SIBLING, "title")).toBe(false);
    expect(withinPriceBandForBasis(OWN, SIBLING, "confirmed")).toBe(true);
  });

  it("no own price means no band", () => {
    expect(withinPriceBandForBasis(null, SIBLING, "title")).toBe(true);
  });
});

describe("assessCompetitor with match basis", () => {
  it("rejects a title/AI match at 2.69x as out-of-band", () => {
    const result = assessCompetitor(
      { price: SIBLING, matchScore: 75, lastScrapedAt: fresh, matchAttributes: { details: "AI" } },
      { ownPrice: OWN, now },
    );
    expect(result.usable).toBe(false);
    expect(result.issues).toContain("out-of-band");
  });

  it("keeps a model-code match at 2.69x", () => {
    const result = assessCompetitor(
      {
        price: SIBLING,
        matchScore: 90,
        lastScrapedAt: fresh,
        matchAttributes: { matchBasis: "model-code" },
      },
      { ownPrice: OWN, now },
    );
    expect(result.usable).toBe(true);
  });

  it("user-confirmed rows have no band", () => {
    const result = assessCompetitor(
      { price: OWN * 5, matchScore: 100, lastScrapedAt: fresh, review: "confirmed" },
      { ownPrice: OWN, now },
    );
    expect(result.usable).toBe(true);
  });

  it("a pending candidate never passes, even with a high score", () => {
    const viaAttrs = assessCompetitor(
      { price: OWN, matchScore: 88, lastScrapedAt: fresh, matchAttributes: { review: "pending" } },
      { ownPrice: OWN, now },
    );
    expect(viaAttrs.usable).toBe(false);
    expect(viaAttrs.issues).toContain("pending");
    const viaField = assessCompetitor(
      { price: OWN, matchScore: 88, lastScrapedAt: fresh, review: "pending" },
      { ownPrice: OWN, now },
    );
    expect(viaField.issues).toContain("pending");
  });

  it("a precomputed matchBasis is honoured (API responses without raw JSON)", () => {
    const result = assessCompetitor(
      { price: SIBLING, matchScore: 90, lastScrapedAt: fresh, matchBasis: "model-code" },
      { ownPrice: OWN, now },
    );
    expect(result.usable).toBe(true);
  });
});

describe("assessCompetitorList peer outlier", () => {
  const code = (price: number) => ({
    price,
    matchScore: 90,
    lastScrapedAt: fresh,
    matchAttributes: { matchBasis: "model-code" },
  });

  it("drops the ₺47K sibling with >=3 other trusted peers even on a code match", () => {
    const inputs = [code(17899), code(18299), code(18999), code(SIBLING)];
    const result = assessCompetitorList(inputs, { ownPrice: OWN, now });
    expect(result[3].usable).toBe(false);
    expect(result[3].issues).toContain("peer-outlier");
    expect(result.slice(0, 3).every((r) => r.usable)).toBe(true);
  });

  it("does not apply with only 2 other peers", () => {
    const inputs = [code(17899), code(18299), code(SIBLING)];
    const result = assessCompetitorList(inputs, { ownPrice: OWN, now });
    expect(result[2].usable).toBe(true);
  });

  it("a confirmed row is exempt from the peer rule", () => {
    const inputs = [
      code(17899),
      code(18299),
      code(18999),
      { price: SIBLING, matchScore: 100, lastScrapedAt: fresh, review: "confirmed" },
    ];
    const result = assessCompetitorList(inputs, { ownPrice: OWN, now });
    expect(result[3].usable).toBe(true);
  });
});

describe("trustedPeerMedian", () => {
  const row = (price: number, extra: Record<string, unknown> = {}) => ({
    price,
    matchScore: 85,
    lastScrapedAt: fresh,
    ...extra,
  });

  it("ignores the own price as band anchor (airfryer 8.999 vs ₺17K market)", () => {
    const inputs = [row(16999), row(17499), row(17999), row(18499)];
    // Kendi fiyat 8.999 olsaydı 0.55x–1.8x bandı (≤16.198) hepsini elerdi.
    expect(trustedPeerMedian(inputs, { now })).toEqual({ median: 17749, count: 4 });
  });

  it("skips pending, low-score and stale rows", () => {
    const inputs = [
      row(17000),
      row(18000),
      row(19000),
      row(5000, { matchAttributes: { review: "pending" } }),
      row(5000, { matchScore: 40 }),
      row(5000, { lastScrapedAt: new Date("2026-11-01T00:00:00Z") }),
    ];
    expect(trustedPeerMedian(inputs, { now })).toEqual({ median: 18000, count: 3 });
  });

  it("returns null median below the minimum peer count", () => {
    expect(trustedPeerMedian([row(17000), row(18000)], { now })).toEqual({
      median: null,
      count: 2,
    });
    expect(trustedPeerMedian([row(17000)], { now, minPeers: 1 }).median).toBe(17000);
  });
});

describe("başlık bandı 0.5x–2x (18 Kasım kararı)", () => {
  it("keeps a same-title rival at 1.94x and drops one beyond 2x", () => {
    expect(withinPriceBandForBasis(179.9, 348.9, "title")).toBe(true);
    expect(withinPriceBandForBasis(179.9, 370, "title")).toBe(false);
    expect(withinPriceBandForBasis(200, 101, "title")).toBe(true);
    expect(withinPriceBandForBasis(200, 99, "title")).toBe(false);
  });
});
