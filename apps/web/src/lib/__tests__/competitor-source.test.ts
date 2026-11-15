import { describe, expect, it } from "vitest";

import {
  GOOGLE_SHOPPING_LABEL,
  isDormantCompetitor,
  isGoogleHostedUrl,
  resolveCompetitorSource,
} from "../competitor-source";
import { readCompetitorSeller } from "../match-review";

const GOOGLE_LINK =
  "https://www.google.com/search?ibp=oshop&q=Philips+Airfryer&prds=catalogid:123,pvo:2&gl=tr";

describe("resolveCompetitorSource", () => {
  it("bilinen pazaryerinde kendi rozetini kullanır", () => {
    expect(
      resolveCompetitorSource({ marketplace: "TRENDYOL", competitorUrl: GOOGLE_LINK }),
    ).toEqual({ marketplace: "TRENDYOL", viaGoogle: true });
  });

  it("Google bağlantısında gerçek satıcı adını gösterir", () => {
    const badge = resolveCompetitorSource({
      marketplace: "CUSTOM",
      competitorUrl: GOOGLE_LINK,
      seller: "Evkur",
    });
    expect(badge).toMatchObject({ overrideName: "Evkur", viaGoogle: true });
  });

  it("satıcı bilinmiyorsa google.com yerine Google Alışveriş yazar", () => {
    const badge = resolveCompetitorSource({ marketplace: "CUSTOM", competitorUrl: GOOGLE_LINK });
    expect(badge.overrideName).toBe(GOOGLE_SHOPPING_LABEL);
    expect(badge.overrideName).not.toContain("google.com");
  });

  it("diğer alan adlarında alan adından türetir", () => {
    const badge = resolveCompetitorSource({
      marketplace: "CUSTOM",
      competitorUrl: "https://www.hepsiburada.com/urun-p-HB1",
    });
    expect(badge).toMatchObject({ overrideName: "Hepsiburada", viaGoogle: false });
    expect(isGoogleHostedUrl("https://www.evkur.com.tr/urun")).toBe(false);
  });
});

describe("isDormantCompetitor", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("30 günden eski otomatik kayıt uykudadır", () => {
    expect(
      isDormantCompetitor({ lastScrapedAt: "2026-07-09T10:00:00Z", matchScore: 85 }, now),
    ).toBe(true);
    expect(
      isDormantCompetitor({ lastScrapedAt: "2026-11-01T10:00:00Z", matchScore: 85 }, now),
    ).toBe(false);
  });

  it("elle eklenen ve kullanıcının onayladığı kayıt asla uykuda sayılmaz", () => {
    expect(
      isDormantCompetitor({ lastScrapedAt: "2026-01-01T10:00:00Z", matchScore: null }, now),
    ).toBe(false);
    expect(
      isDormantCompetitor(
        { lastScrapedAt: "2026-01-01T10:00:00Z", matchScore: 100, review: "confirmed" },
        now,
      ),
    ).toBe(false);
  });

  it("hiç taranmamış kayıtta oluşturulma tarihine bakar", () => {
    expect(
      isDormantCompetitor(
        { lastScrapedAt: null, createdAt: "2026-06-01T10:00:00Z", matchScore: 80 },
        now,
      ),
    ).toBe(true);
    expect(isDormantCompetitor({ lastScrapedAt: null, matchScore: 80 }, now)).toBe(false);
  });
});

describe("readCompetitorSeller", () => {
  it("satıcı adını okur, boş değerleri yok sayar", () => {
    expect(readCompetitorSeller({ seller: " Evkur " })).toBe("Evkur");
    expect(readCompetitorSeller({ seller: "" })).toBeNull();
    expect(readCompetitorSeller(null)).toBeNull();
  });
});
