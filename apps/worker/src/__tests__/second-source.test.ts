import { describe, expect, it } from "vitest";

import {
  buildMarketplaceSearchQuery,
  isMarketplaceProductUrl,
  mapOrganicToShoppingResults,
} from "../serper";
import { shouldSearchMarketplacePages } from "../utils/second-source";

describe("isMarketplaceProductUrl", () => {
  it("accepts product pages of supported marketplaces", () => {
    const urls = [
      "https://www.trendyol.com/arzum/okka-minio-turk-kahvesi-makinesi-p-6372252?boutiqueId=61",
      "https://www.hepsiburada.com/arzum-ok004-okka-minio-turk-kahvesi-makinesi-bakir-p-HBV000001ALSP",
      "https://www.hepsiburada.com/artema-maestro-a42146-pull-out-eviye-bataryasi-pm-HB000006CYGR",
      "https://www.n11.com/urun/oral-b-sarjli-vitality-pro-18872592?magaza=x",
      "https://www.amazon.com.tr/dp/B0767DNSMH",
      "https://www.amazon.com.tr/Philips-Airfryer/dp/B0767DNSMH/ref=sr_1_1",
      "https://www.pttavm.com/arzum-okka-minio-p-123456",
    ];
    for (const url of urls) expect(isMarketplaceProductUrl(url), url).toBe(true);
  });

  it("rejects search, category, brand and store pages and unknown hosts", () => {
    const urls = [
      "https://www.trendyol.com/sr?q=okka+minio",
      "https://www.trendyol.com/arzum-turk-kahve-makinesi-x-b101-c1234",
      "https://www.hepsiburada.com/ara?q=okka",
      "https://www.hepsiburada.com/arzum-turk-kahve-makineleri-xc-1234",
      "https://www.n11.com/arama?q=okka",
      "https://www.amazon.com.tr/s?k=okka",
      "https://www.akakce.com/kahve-makinesi/en-ucuz-arzum-ok004-fiyati,1.html",
      "not a url",
    ];
    for (const url of urls) expect(isMarketplaceProductUrl(url), url).toBe(false);
  });
});

describe("buildMarketplaceSearchQuery", () => {
  it("restricts the query to marketplace domains", () => {
    const q = buildMarketplaceSearchQuery("  Arzum OK004 Okka Minio ");
    expect(q.startsWith("Arzum OK004 Okka Minio (site:trendyol.com OR ")).toBe(true);
    expect(q).toContain("site:hepsiburada.com");
    expect(q).toContain("site:amazon.com.tr");
  });
});

describe("mapOrganicToShoppingResults", () => {
  it("keeps product pages only and carries a TRY rich-snippet price", () => {
    const mapped = mapOrganicToShoppingResults([
      {
        title: "Arzum OK004 Okka Minio",
        link: "https://www.trendyol.com/arzum/okka-p-123",
        price: 1616.16,
        currency: "TRY",
        position: 1,
      },
      { title: "Kategori", link: "https://www.trendyol.com/sr?q=okka", position: 2 },
      { title: "Fiyatsız", link: "https://www.n11.com/urun/okka-99", position: 3 },
      {
        title: "Dolar",
        link: "https://www.amazon.com.tr/dp/B0767DNSMH",
        price: 20,
        currency: "USD",
      },
      { link: "https://www.n11.com/urun/basliksiz-1" },
    ]);
    expect(mapped.map((r) => r.link)).toEqual([
      "https://www.trendyol.com/arzum/okka-p-123",
      "https://www.n11.com/urun/okka-99",
      "https://www.amazon.com.tr/dp/B0767DNSMH",
    ]);
    expect(mapped[0].price).toBe("1.616,16");
    expect(mapped[1].price).toBe("");
    expect(mapped[2].price).toBe("");
  });
});

describe("shouldSearchMarketplacePages", () => {
  it("uses the second source only while the product has few competitors", () => {
    expect(shouldSearchMarketplacePages(0, 0)).toBe(true);
    expect(shouldSearchMarketplacePages(2, 4)).toBe(true);
    expect(shouldSearchMarketplacePages(5, 0)).toBe(false);
    expect(shouldSearchMarketplacePages(0, 12)).toBe(false);
  });
});
