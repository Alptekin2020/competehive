import { describe, it, expect } from "vitest";

import {
  PLAN_LIMITS,
  MARKETPLACES,
  getMarketplaceInfo,
  getRetailerInfoFromDomain,
  SUPPORTED_SCRAPER_MARKETPLACES,
} from "../index";

describe("PLAN_LIMITS", () => {
  it("should have all four plans", () => {
    expect(Object.keys(PLAN_LIMITS)).toEqual(["FREE", "STARTER", "PRO", "ENTERPRISE"]);
  });

  it("should have increasing maxProducts across plans", () => {
    const limits = [
      PLAN_LIMITS.FREE.maxProducts,
      PLAN_LIMITS.STARTER.maxProducts,
      PLAN_LIMITS.PRO.maxProducts,
      PLAN_LIMITS.ENTERPRISE.maxProducts,
    ];
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i]).toBeGreaterThan(limits[i - 1]);
    }
  });

  it("should have decreasing scrapeIntervalMinutes across plans", () => {
    const intervals = [
      PLAN_LIMITS.FREE.scrapeIntervalMinutes,
      PLAN_LIMITS.STARTER.scrapeIntervalMinutes,
      PLAN_LIMITS.PRO.scrapeIntervalMinutes,
      PLAN_LIMITS.ENTERPRISE.scrapeIntervalMinutes,
    ];
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeLessThan(intervals[i - 1]);
    }
  });

  it("FREE plan should only have EMAIL channel", () => {
    expect(PLAN_LIMITS.FREE.channels).toEqual(["EMAIL"]);
  });

  it("ENTERPRISE plan should have API access", () => {
    expect(PLAN_LIMITS.ENTERPRISE.apiAccess).toBe(true);
  });
});

describe("MARKETPLACES", () => {
  it("should have at least 20 marketplaces", () => {
    expect(Object.keys(MARKETPLACES).length).toBeGreaterThanOrEqual(20);
  });

  it("each marketplace should have required fields", () => {
    for (const [key, mp] of Object.entries(MARKETPLACES)) {
      expect(mp.id).toBe(key);
      expect(mp.name).toBeTruthy();
      expect(mp.icon).toBeTruthy();
      expect(mp.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("SUPPORTED_SCRAPER_MARKETPLACES should be a subset of MARKETPLACES", () => {
    for (const mp of SUPPORTED_SCRAPER_MARKETPLACES) {
      expect(MARKETPLACES[mp]).toBeDefined();
    }
  });
});

describe("getMarketplaceInfo", () => {
  it("should return correct info for known marketplace", () => {
    const info = getMarketplaceInfo("TRENDYOL");
    expect(info.name).toBe("Trendyol");
    expect(info.color).toBe("#F27A1A");
  });

  it("should return fallback for unknown marketplace", () => {
    const info = getMarketplaceInfo("UNKNOWN_MP");
    expect(info.name).toBe("UNKNOWN_MP");
    expect(info.color).toBe("#9CA3AF");
  });
});

describe("getRetailerInfoFromDomain", () => {
  it("should match trendyol.com domain", () => {
    const info = getRetailerInfoFromDomain("www.trendyol.com");
    expect(info.retailerName).toBe("Trendyol");
    expect(info.retailerColor).toBe("#F27A1A");
  });

  it("should match domain without www prefix", () => {
    const info = getRetailerInfoFromDomain("hepsiburada.com");
    expect(info.retailerName).toBe("Hepsiburada");
  });

  it("should return domain as fallback for unknown domain", () => {
    const info = getRetailerInfoFromDomain("somestore.com");
    expect(info.retailerName).toBe("somestore.com");
    expect(info.retailerDomain).toBe("somestore.com");
    expect(info.retailerColor).toBe("#6B7280");
  });
});
