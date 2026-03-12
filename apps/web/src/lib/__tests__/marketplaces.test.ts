import { describe, it, expect } from "vitest";
import { detectMarketplaceFromUrl, MARKETPLACE_VALUES } from "../marketplaces";

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
});
