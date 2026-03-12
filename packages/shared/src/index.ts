// ============================================
// CompeteHive Shared Types
// ============================================

export { validateWebEnv, validateWorkerEnv, webEnvSchema, workerEnvSchema } from "./env";
export type { WebEnv, WorkerEnv } from "./env";
export type {
  TrackedProductRow,
  CompetitorRow,
  ProductWithCompetitors,
  AlertRuleRow,
  NotificationRow,
  AlertUser,
  AlertRuleWithUser,
  CompareCompetitorResult,
} from "./types";

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
  TRENDYOL: {
    id: "TRENDYOL",
    name: "Trendyol",
    domain: "trendyol.com",
    icon: "🟠",
    color: "#F27A1A",
  },
  HEPSIBURADA: {
    id: "HEPSIBURADA",
    name: "Hepsiburada",
    domain: "hepsiburada.com",
    icon: "🟡",
    color: "#FF6000",
  },
  AMAZON_TR: {
    id: "AMAZON_TR",
    name: "Amazon TR",
    domain: "amazon.com.tr",
    icon: "📦",
    color: "#FF9900",
  },
  N11: { id: "N11", name: "N11", domain: "n11.com", icon: "🟣", color: "#7B2D8E" },
  CICEKSEPETI: {
    id: "CICEKSEPETI",
    name: "Çiçeksepeti",
    domain: "ciceksepeti.com",
    icon: "🌸",
    color: "#E91E63",
  },
  PTTAVM: {
    id: "PTTAVM",
    name: "PTT AVM",
    domain: "pttavm.com",
    icon: "📮",
    color: "#FFD600",
  },
  AKAKCE: {
    id: "AKAKCE",
    name: "Akakçe",
    domain: "akakce.com",
    icon: "🔍",
    color: "#00BCD4",
  },
  CIMRI: { id: "CIMRI", name: "Cimri", domain: "cimri.com", icon: "💰", color: "#4CAF50" },
  EPEY: { id: "EPEY", name: "Epey", domain: "epey.com", icon: "📊", color: "#2196F3" },
  BOYNER: {
    id: "BOYNER",
    name: "Boyner",
    domain: "boyner.com.tr",
    icon: "👔",
    color: "#1A1A1A",
  },
  GRATIS: {
    id: "GRATIS",
    name: "Gratis",
    domain: "grfratis.com",
    icon: "💄",
    color: "#FF4081",
  },
  WATSONS: {
    id: "WATSONS",
    name: "Watsons",
    domain: "watsons.com.tr",
    icon: "🧴",
    color: "#00A19A",
  },
  KITAPYURDU: {
    id: "KITAPYURDU",
    name: "Kitapyurdu",
    domain: "kitapyurdu.com",
    icon: "📚",
    color: "#FF5722",
  },
  DECATHLON: {
    id: "DECATHLON",
    name: "Decathlon",
    domain: "decathlon.com.tr",
    icon: "⚽",
    color: "#0082C3",
  },
  TEKNOSA: {
    id: "TEKNOSA",
    name: "Teknosa",
    domain: "teknosa.com",
    icon: "📱",
    color: "#ED1C24",
  },
  SEPHORA: {
    id: "SEPHORA",
    name: "Sephora",
    domain: "sephora.com.tr",
    icon: "✨",
    color: "#000000",
  },
  KOCTAS: {
    id: "KOCTAS",
    name: "Koçtaş",
    domain: "koctas.com.tr",
    icon: "🔨",
    color: "#FF6F00",
  },
  MEDIAMARKT: {
    id: "MEDIAMARKT",
    name: "MediaMarkt",
    domain: "mediamarkt.com.tr",
    icon: "🖥️",
    color: "#DF0000",
  },
  VATAN: {
    id: "VATAN",
    name: "Vatan Bilgisayar",
    domain: "vatanbilgisayar.com",
    icon: "💻",
    color: "#003399",
  },
  ITOPYA: {
    id: "ITOPYA",
    name: "İtopya",
    domain: "itopya.com",
    icon: "🎮",
    color: "#00C853",
  },
  SHOPIFY: {
    id: "SHOPIFY",
    name: "Shopify",
    domain: "myshopify.com",
    icon: "🛍️",
    color: "#96BF48",
  },
  CUSTOM: { id: "CUSTOM", name: "Diğer", domain: "", icon: "🌐", color: "#9CA3AF" },
};

/**
 * Get marketplace label info by key. Returns a fallback for unknown keys.
 */
export function getMarketplaceInfo(key: string): { name: string; color: string } {
  const mp = MARKETPLACES[key];
  return mp ? { name: mp.name, color: mp.color } : { name: key, color: "#9CA3AF" };
}

/**
 * Get retailer info from a URL domain.
 */
export function getRetailerInfoFromDomain(domain: string): {
  retailerDomain: string;
  retailerName: string;
  retailerColor: string;
} {
  const cleanDomain = domain.replace("www.", "");
  const mp = Object.values(MARKETPLACES).find((m) => cleanDomain.includes(m.domain) && m.domain);
  return {
    retailerDomain: cleanDomain,
    retailerName: mp?.name ?? cleanDomain,
    retailerColor: mp?.color ?? "#6B7280",
  };
}

export const SUPPORTED_SCRAPER_MARKETPLACES = [
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
] as const;

export type SupportedScraperMarketplace = (typeof SUPPORTED_SCRAPER_MARKETPLACES)[number];
