import { describe, expect, it } from "vitest";

import { shouldPurgeCompetitor } from "../jobs/competitor-cleanup";
import { isSameListing, listingIdentity, rejectionLinkHint } from "../utils/url-match";

describe("listingIdentity", () => {
  it("keys Trendyol listings by product id, ignoring slug and seller params", () => {
    // Canlı vaka (2026-11-15): kendi Siveno ilanı farklı slug ile rakip oldu.
    expect(
      isSameListing(
        "https://www.trendyol.com/siveno/sivrisinek-ve-kene-kovucu-sprey-losyon-bitkisel-tum-vucut-icin-seyahat-tatil-boy-50-ml-p-684477925",
        "https://www.trendyol.com/siveno/sivrisinek-ve-kene-kovucu-losyon-bitkisel-50ml-p-684477925",
      ),
    ).toBe(true);
    expect(
      isSameListing(
        "https://www.trendyol.com/icollagen/kolajen-ve-prebiyotik-tablet-p-752356123",
        "https://www.trendyol.com/icollagen/kolajen-ve-prebiyotik-tablet-60-adet-p-752356123?boutiqueId=61&merchantId=1",
      ),
    ).toBe(true);
  });

  it("keeps different listings apart", () => {
    expect(
      isSameListing(
        "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-avance-collection-fritoz-p-14262809",
        "https://www.trendyol.com/philips/hd9650-90-xxl-avance-collection-air-fryer-7-3-litre-yagsiz-fritoz-p-750152581",
      ),
    ).toBe(false);
    expect(
      isSameListing("https://www.trendyol.com/a/b-p-123", "https://www.hepsiburada.com/a-b-p-123"),
    ).toBe(false);
  });

  it("reads Hepsiburada, Amazon and N11 ids", () => {
    expect(listingIdentity("https://www.hepsiburada.com/oral-b-d103-pm-HBC00002LN3IF")).toBe(
      "hepsiburada:HBC00002LN3IF",
    );
    expect(listingIdentity("https://www.amazon.com.tr/Siveno-Sivrisinek/dp/B0D8T6HRMX?th=1")).toBe(
      "amazon:B0D8T6HRMX",
    );
    expect(listingIdentity("https://www.n11.com/urun/oral-b-vitality-pro-18872592?magaza=x")).toBe(
      "n11:18872592",
    );
  });

  it("falls back to host + path for other sites", () => {
    expect(
      isSameListing("https://seninev.com/urun/CR-1824", "https://seninev.com/urun/CR-1824/"),
    ).toBe(true);
    expect(isSameListing("", "")).toBe(false);
  });
});

describe("shouldPurgeCompetitor own-listing", () => {
  const ownUrl = "https://www.trendyol.com/siveno/sprey-losyon-50-ml-p-684477925";
  const context = {
    productName: "Siveno Sivrisinek Losyon 50 ml",
    ownPrice: 249.9,
    productUrl: ownUrl,
  };

  it("purges an automated row that points to our own listing", () => {
    expect(
      shouldPurgeCompetitor(
        {
          competitorName: "Siveno Sivrisinek ve Kene Kovucu Losyon",
          competitorPrice: 249.9,
          matchScore: 88,
          competitorUrl: "https://www.trendyol.com/siveno/losyon-bitkisel-50ml-p-684477925",
          matchAttributes: { seller: "Trendyol" },
        },
        context,
      ),
    ).toBe("own-listing");
  });

  it("keeps manual and user-confirmed rows", () => {
    const base = {
      competitorName: "Siveno",
      competitorPrice: 249.9,
      competitorUrl: "https://www.trendyol.com/siveno/x-p-684477925",
    };
    expect(shouldPurgeCompetitor({ ...base, matchScore: null }, context)).toBeNull();
    expect(
      shouldPurgeCompetitor(
        { ...base, matchScore: 100, matchAttributes: { review: "confirmed" } },
        context,
      ),
    ).toBeNull();
  });
});

describe("rejectionLinkHint", () => {
  it("keeps host and path, drops the query", () => {
    expect(
      rejectionLinkHint("https://www.trendyol.com/pati/kedi-kumu-2-adet-p-1?boutiqueId=61"),
    ).toBe("trendyol.com/pati/kedi-kumu-2-adet-p-1");
  });
  it("names Google cards and handles missing links", () => {
    expect(rejectionLinkHint("https://www.google.com/search?ibp=oshop&prds=x")).toBe(
      "google ürün kartı",
    );
    expect(rejectionLinkHint(undefined)).toBe("bağlantı yok");
  });
});
