// ============================================
// CompeteHive Shared Types
// ============================================

export interface PlanLimits {
  maxProducts: number;
  scrapeIntervalMinutes: number;
  marketplaces: number;
  priceHistoryDays: number;
  channels: string[];
  autoRules: boolean;
  apiAccess: boolean;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  FREE: {
    maxProducts: 5,
    scrapeIntervalMinutes: 1440, // günde 1
    marketplaces: 1,
    priceHistoryDays: 7,
    channels: ["EMAIL"],
    autoRules: false,
    apiAccess: false,
  },
  STARTER: {
    maxProducts: 50,
    scrapeIntervalMinutes: 60,
    marketplaces: 2,
    priceHistoryDays: 30,
    channels: ["EMAIL", "TELEGRAM"],
    autoRules: false,
    apiAccess: false,
  },
  PRO: {
    maxProducts: 500,
    scrapeIntervalMinutes: 15,
    marketplaces: 99, // tümü
    priceHistoryDays: 365,
    channels: ["EMAIL", "TELEGRAM", "WEBHOOK"],
    autoRules: true,
    apiAccess: false,
  },
  ENTERPRISE: {
    maxProducts: 99999,
    scrapeIntervalMinutes: 5,
    marketplaces: 99,
    priceHistoryDays: 99999,
    channels: ["EMAIL", "TELEGRAM", "WEBHOOK"],
    autoRules: true,
    apiAccess: true,
  },
};

export interface MarketplaceInfo {
  id: string;
  name: string;
  domain: string;
  icon: string;
  color: string;
}

export const MARKETPLACES: Record<string, MarketplaceInfo> = {
  TRENDYOL: { id: "TRENDYOL", name: "Trendyol", domain: "trendyol.com", icon: "🟠", color: "#F27A1A" },
  HEPSIBURADA: { id: "HEPSIBURADA", name: "Hepsiburada", domain: "hepsiburada.com", icon: "🟡", color: "#FF6000" },
  AMAZON_TR: { id: "AMAZON_TR", name: "Amazon TR", domain: "amazon.com.tr", icon: "📦", color: "#FF9900" },
  N11: { id: "N11", name: "N11", domain: "n11.com", icon: "🟣", color: "#7B2D8E" },
};

export const SUPPORTED_SCRAPER_MARKETPLACES = [
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
] as const;

export type SupportedScraperMarketplace = (typeof SUPPORTED_SCRAPER_MARKETPLACES)[number];
