// Centralized plan permission checks

export interface PlanFeatures {
  maxProducts: number;
  maxAlertRules: number;
  maxTags: number;
  scrapeIntervalMinutes: number;
  marketplaceLimit: number;
  priceHistoryDays: number;
  allowedChannels: string[];
  hasBulkImport: boolean;
  hasTagSystem: boolean;
  hasAnalytics: boolean;
  hasAutoRules: boolean;
  hasApiAccess: boolean;
}

export const PLAN_FEATURES: Record<string, PlanFeatures> = {
  FREE: {
    maxProducts: 5,
    maxAlertRules: 3,
    maxTags: 0,
    scrapeIntervalMinutes: 1440,
    marketplaceLimit: 1,
    priceHistoryDays: 7,
    allowedChannels: ["EMAIL"],
    hasBulkImport: false,
    hasTagSystem: false,
    hasAnalytics: false,
    hasAutoRules: false,
    hasApiAccess: false,
  },
  STARTER: {
    maxProducts: 50,
    maxAlertRules: 20,
    maxTags: 10,
    scrapeIntervalMinutes: 60,
    marketplaceLimit: 2,
    priceHistoryDays: 30,
    allowedChannels: ["EMAIL", "TELEGRAM"],
    hasBulkImport: true,
    hasTagSystem: true,
    hasAnalytics: false,
    hasAutoRules: false,
    hasApiAccess: false,
  },
  PRO: {
    maxProducts: 500,
    maxAlertRules: 100,
    maxTags: 20,
    scrapeIntervalMinutes: 15,
    marketplaceLimit: 99,
    priceHistoryDays: 365,
    allowedChannels: ["EMAIL", "TELEGRAM", "WEBHOOK"],
    hasBulkImport: true,
    hasTagSystem: true,
    hasAnalytics: true,
    hasAutoRules: true,
    hasApiAccess: false,
  },
  ENTERPRISE: {
    maxProducts: 99999,
    maxAlertRules: 99999,
    maxTags: 99999,
    scrapeIntervalMinutes: 5,
    marketplaceLimit: 99,
    priceHistoryDays: 99999,
    allowedChannels: ["EMAIL", "TELEGRAM", "WEBHOOK"],
    hasBulkImport: true,
    hasTagSystem: true,
    hasAnalytics: true,
    hasAutoRules: true,
    hasApiAccess: true,
  },
};

export function getPlanFeatures(plan: string): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.FREE;
}

export function canUseFeature(plan: string, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return true;
}

export function requiredPlanFor(feature: keyof PlanFeatures): string {
  const plans = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
  for (const plan of plans) {
    if (canUseFeature(plan, feature)) return plan;
  }
  return "ENTERPRISE";
}
