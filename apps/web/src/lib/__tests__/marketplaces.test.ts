import { describe, it, expect } from "vitest";
import {
  detectMarketplaceFromUrl,
  MARKETPLACE_VALUES,
  isScraperSupportedMarketplace,
  isTrackableMarketplace,
  storeBadgeName,
  storeDisplayName,
  storeKey,
} from "../marketplaces";

describe("detectMarketplaceFromUrl", () => {
  it("should detect Trendyol URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.trendyol.com/product/123")).toBe("TRENDYOL");
  });

  it("should detect Hepsiburada URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.hepsiburada.com/urun-p-123")).toBe("HEPSIBURADA");
  });

  it("should detect Amazon TR URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.amazon.com.tr/dp/B123")).toBe("AMAZON_TR");
  });

  it("should detect N11 URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.n11.com/urun/product-123")).toBe("N11");
  });

  it("should detect Teknosa URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.teknosa.com/product")).toBe("TEKNOSA");
  });

  it("should detect Vatan Bilgisayar URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.vatanbilgisayar.com/laptop/")).toBe("VATAN");
  });

  it("should return CUSTOM for unknown URLs", () => {
    expect(detectMarketplaceFromUrl("https://www.unknown-store.com/product")).toBe("CUSTOM");
  });

  it("should be case-insensitive", () => {
    expect(detectMarketplaceFromUrl("HTTPS://WWW.TRENDYOL.COM/PRODUCT")).toBe("TRENDYOL");
  });

  it("should include CUSTOM in MARKETPLACE_VALUES", () => {
    expect(MARKETPLACE_VALUES).toContain("CUSTOM");
  });

  it("should include all 4 scraper-supported marketplaces", () => {
    for (const mp of ["TRENDYOL", "HEPSIBURADA", "AMAZON_TR", "N11"]) {
      expect(MARKETPLACE_VALUES).toContain(mp);
    }
  });

  it("should detect PTT AVM URLs as PTTAVM", () => {
    expect(detectMarketplaceFromUrl("https://www.pttavm.com/urun/abc-123")).toBe("PTTAVM");
  });
});

describe("isScraperSupportedMarketplace", () => {
  it("accepts marketplaces the worker can scrape", () => {
    for (const mp of ["TRENDYOL", "HEPSIBURADA", "AMAZON_TR", "N11", "MEDIAMARKT", "PTTAVM"]) {
      expect(isScraperSupportedMarketplace(mp)).toBe(true);
    }
  });

  it("rejects unsupported marketplaces and CUSTOM", () => {
    for (const mp of ["CICEKSEPETI", "AKAKCE", "SHOPIFY", "CUSTOM", "UNKNOWN"]) {
      expect(isScraperSupportedMarketplace(mp)).toBe(false);
    }
  });
});

describe("detectMarketplaceFromUrl (hostname matching)", () => {
  it("ignores marketplace domains that only appear in the path or query", () => {
    expect(detectMarketplaceFromUrl("https://seninev.com/urun/CR-1693?ref=trendyol.com")).toBe(
      "CUSTOM",
    );
    expect(detectMarketplaceFromUrl("https://seninev.com/n11.com-kampanya")).toBe("CUSTOM");
  });

  it("does not match a domain that merely ends with a marketplace name", () => {
    expect(detectMarketplaceFromUrl("https://notrendyol.com/p/1")).toBe("CUSTOM");
  });

  it("matches subdomains and country TLD variants", () => {
    expect(detectMarketplaceFromUrl("https://m.trendyol.com/p/1")).toBe("TRENDYOL");
    expect(detectMarketplaceFromUrl("https://www.mediamarkt.com.tr/tr/product/x")).toBe(
      "MEDIAMARKT",
    );
    expect(detectMarketplaceFromUrl("https://magaza.myshopify.com/products/x")).toBe("SHOPIFY");
  });

  it("returns CUSTOM for unparsable URLs", () => {
    expect(detectMarketplaceFromUrl("not a url")).toBe("CUSTOM");
  });
});

describe("isTrackableMarketplace", () => {
  it("accepts dedicated marketplaces and independent store sites", () => {
    for (const mp of ["TRENDYOL", "PTTAVM", "CUSTOM", "SHOPIFY"]) {
      expect(isTrackableMarketplace(mp)).toBe(true);
    }
  });

  it("still rejects comparison sites and DECATHLON", () => {
    for (const mp of ["AKAKCE", "CIMRI", "EPEY", "DECATHLON"]) {
      expect(isTrackableMarketplace(mp)).toBe(false);
    }
  });
});

describe("store identity helpers", () => {
  it("keys independent stores by domain and marketplaces by enum", () => {
    expect(storeKey("CUSTOM", "https://www.seninev.com/urun/1")).toBe("store:seninev.com");
    expect(storeKey("CUSTOM", "https://karaca.com/p/2")).toBe("store:karaca.com");
    expect(storeKey("TRENDYOL", "https://www.trendyol.com/p/3")).toBe("TRENDYOL");
  });

  it("labels independent stores with their domain", () => {
    expect(storeBadgeName("CUSTOM", "https://www.seninev.com/urun/1")).toBe("seninev.com");
    expect(storeBadgeName("TRENDYOL", "https://www.trendyol.com/p/3")).toBeUndefined();
    expect(storeDisplayName("CUSTOM", "https://seninev.com/urun/1")).toBe("seninev.com");
    expect(storeDisplayName("TRENDYOL", "https://www.trendyol.com/p/3")).toBe("Trendyol");
  });
});
