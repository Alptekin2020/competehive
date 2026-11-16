import { describe, expect, it } from "vitest";

import {
  competitorOpenLabel,
  competitorOpenUrl,
  GOOGLE_SEARCH_LABEL,
  GOOGLE_SHOPPING_LABEL,
  isDormantCompetitor,
  isGoogleHostedUrl,
  resolveCompetitorSource,
  UNKNOWN_SELLER_LABEL,
} from "../competitor-source";
import { readCompetitorSeller } from "../match-review";

const GOOGLE_LINK =
  "https://www.google.com/search?ibp=oshop&q=Philips+Airfryer&prds=catalogid:123,pvo:2&gl=tr";

describe("resolveCompetitorSource", () => {
  it("bilinen pazaryerinde kendi rozetini kullanır", () => {
    expect(
      resolveCompetitorSource({ marketplace: "TRENDYOL", competitorUrl: GOOGLE_LINK }),
    ).toEqual({ marketplace: "TRENDYOL", viaGoogle: true, sourceLabel: GOOGLE_SHOPPING_LABEL });
  });

  it("Google bağlantısında gerçek satıcı adını gösterir", () => {
    const badge = resolveCompetitorSource({
      marketplace: "CUSTOM",
      competitorUrl: GOOGLE_LINK,
      seller: "Evkur",
    });
    expect(badge).toMatchObject({
      overrideName: "Evkur",
      viaGoogle: true,
      sourceLabel: GOOGLE_SHOPPING_LABEL,
    });
    expect(badge.overrideName).not.toBe(GOOGLE_SHOPPING_LABEL);
  });

  it("satıcı bilinmiyorsa 'Satıcı bilinmiyor' yazar; Google Alışveriş yalnızca kaynak etiketidir", () => {
    const badge = resolveCompetitorSource({ marketplace: "CUSTOM", competitorUrl: GOOGLE_LINK });
    expect(badge.overrideName).toBe(UNKNOWN_SELLER_LABEL);
    expect(badge.sourceLabel).toBe(GOOGLE_SHOPPING_LABEL);
    expect(badge.overrideName).not.toContain("google.com");
  });

  it("satıcı adı Google'ın kendisiyse satıcı bilinmiyor sayılır", () => {
    for (const seller of ["Google", "Google Alışveriş", "google.com", "  "]) {
      const badge = resolveCompetitorSource({
        marketplace: "CUSTOM",
        competitorUrl: GOOGLE_LINK,
        seller,
      });
      expect(badge.overrideName).toBe(UNKNOWN_SELLER_LABEL);
    }
  });

  it("diğer alan adlarında alan adından türetir", () => {
    const badge = resolveCompetitorSource({
      marketplace: "CUSTOM",
      competitorUrl: "https://www.hepsiburada.com/urun-p-HB1",
    });
    expect(badge).toMatchObject({ overrideName: "Hepsiburada", viaGoogle: false });
    expect(badge.sourceLabel).toBeUndefined();
    expect(isGoogleHostedUrl("https://www.evkur.com.tr/urun")).toBe(false);
  });
});

describe("competitorOpenUrl", () => {
  // Sahibinin ekran görüntüsündeki ölü kart ("Bu ürünle ilgili ayrıntı yok").
  const DEAD_CARD =
    "https://www.google.com/search?ibp=oshop&q=Philips+Series+3300&prds=catalogid:987,headlineOfferDocid:55,pvo:2&gl=tr";
  const TITLE = "Philips Series 3300 tam otomatik espresso makinesi 6 sıcak ve buzlu içecek";

  it("Google kartını asla açmaz; başlık + satıcıyla taze Google Alışveriş araması açar", () => {
    const url = competitorOpenUrl({
      competitorUrl: DEAD_CARD,
      competitorName: TITLE,
      seller: "Evkur",
    });
    expect(url.startsWith("https://www.google.com/search?udm=28&gl=tr&hl=tr&q=")).toBe(true);
    expect(url).not.toContain("ibp=oshop");
    expect(url).not.toContain("prds=");
    const q = new URL(url).searchParams.get("q");
    expect(q).toBe(`${TITLE} Evkur`);
    expect(url).toContain(encodeURIComponent(TITLE));
    expect(competitorOpenLabel({ competitorUrl: DEAD_CARD })).toBe(GOOGLE_SEARCH_LABEL);
  });

  it("satıcı bilinmiyorsa (veya Google ise) yalnızca başlıkla arar", () => {
    const url = competitorOpenUrl({
      competitorUrl: DEAD_CARD,
      competitorName: "  Philips EP3347/90  ",
      seller: "Google",
    });
    expect(new URL(url).searchParams.get("q")).toBe("Philips EP3347/90");
    expect(new URL(url).searchParams.get("udm")).toBe("28");
  });

  it("gerçek pazaryeri bağlantısını olduğu gibi açar", () => {
    const real = "https://www.trendyol.com/philips/ep3347-90-p-123456";
    expect(competitorOpenUrl({ competitorUrl: real, competitorName: "x" })).toBe(real);
    expect(competitorOpenLabel({ competitorUrl: real })).toBe("Rakip ürüne git");
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

describe("isDormantCompetitor dead listings", () => {
  const now = new Date("2026-11-16T03:26:00Z");
  it("treats an automated row whose listing is gone as dormant right away", () => {
    expect(
      isDormantCompetitor(
        { lastScrapedAt: "2026-11-15T10:00:00Z", matchScore: 88, deadAt: "2026-11-16T00:00:00Z" },
        now,
      ),
    ).toBe(true);
  });

  it("never hides manual or confirmed rows, even when dead", () => {
    const deadAt = "2026-11-16T00:00:00Z";
    expect(
      isDormantCompetitor({ lastScrapedAt: "2026-11-15T10:00:00Z", matchScore: null, deadAt }, now),
    ).toBe(false);
    expect(
      isDormantCompetitor(
        { lastScrapedAt: "2026-11-15T10:00:00Z", matchScore: 100, review: "confirmed", deadAt },
        now,
      ),
    ).toBe(false);
  });
});
