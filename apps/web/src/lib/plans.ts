export interface PlanInfo {
  id: string;
  name: string;
  price: number; // Monthly in TRY
  yearlyPrice: number; // Monthly price when billed yearly
  whopPlanId: string | null; // Whop plan_xxxxx ID (null for FREE)
  whopYearlyPlanId: string | null; // Whop yearly plan ID
  maxProducts: number;
  scrapeInterval: string;
  marketplaces: string;
  priceHistoryDays: number;
  channels: string[];
  features: string[];
  highlighted: boolean;
  badge?: string;
}

export const PLANS: PlanInfo[] = [
  {
    id: "FREE",
    name: "Ücretsiz",
    price: 0,
    yearlyPrice: 0,
    whopPlanId: null,
    whopYearlyPlanId: null,
    maxProducts: 5,
    scrapeInterval: "Günde 1",
    marketplaces: "1 marketplace",
    priceHistoryDays: 7,
    channels: ["E-posta"],
    features: [
      "5 ürün takibi",
      "Günde 1 tarama",
      "1 marketplace",
      "7 gün fiyat geçmişi",
      "E-posta bildirimleri",
    ],
    highlighted: false,
  },
  {
    id: "STARTER",
    name: "Başlangıç",
    price: 299,
    yearlyPrice: 249,
    whopPlanId: process.env.NEXT_PUBLIC_WHOP_STARTER_PLAN_ID || "plan_STARTER_PLACEHOLDER",
    whopYearlyPlanId: process.env.NEXT_PUBLIC_WHOP_STARTER_YEARLY_PLAN_ID || null,
    maxProducts: 50,
    scrapeInterval: "Saatte 1",
    marketplaces: "2 marketplace",
    priceHistoryDays: 30,
    channels: ["E-posta", "Telegram"],
    features: [
      "50 ürün takibi",
      "Saatte 1 tarama",
      "2 marketplace",
      "30 gün fiyat geçmişi",
      "E-posta + Telegram",
      "Toplu URL import",
      "Etiketleme sistemi",
    ],
    highlighted: true,
    badge: "En Popüler",
  },
  {
    id: "PRO",
    name: "Profesyonel",
    price: 799,
    yearlyPrice: 649,
    whopPlanId: process.env.NEXT_PUBLIC_WHOP_PRO_PLAN_ID || "plan_PRO_PLACEHOLDER",
    whopYearlyPlanId: process.env.NEXT_PUBLIC_WHOP_PRO_YEARLY_PLAN_ID || null,
    maxProducts: 500,
    scrapeInterval: "15 dakika",
    marketplaces: "Tüm marketplace'ler",
    priceHistoryDays: 365,
    channels: ["E-posta", "Telegram", "Webhook"],
    features: [
      "500 ürün takibi",
      "15 dakikada 1 tarama",
      "Tüm marketplace'ler (8+)",
      "1 yıl fiyat geçmişi",
      "E-posta + Telegram + Webhook",
      "Otomatik fiyat kuralları",
      "Analitik dashboard",
      "Öncelikli destek",
    ],
    highlighted: false,
  },
  {
    id: "ENTERPRISE",
    name: "Kurumsal",
    price: 1999,
    yearlyPrice: 1599,
    whopPlanId: process.env.NEXT_PUBLIC_WHOP_ENTERPRISE_PLAN_ID || "plan_ENTERPRISE_PLACEHOLDER",
    whopYearlyPlanId: process.env.NEXT_PUBLIC_WHOP_ENTERPRISE_YEARLY_PLAN_ID || null,
    maxProducts: 99999,
    scrapeInterval: "5 dakika",
    marketplaces: "Tüm marketplace'ler",
    priceHistoryDays: 99999,
    channels: ["E-posta", "Telegram", "Webhook"],
    features: [
      "Sınırsız ürün takibi",
      "5 dakikada 1 tarama",
      "Tüm marketplace'ler (8+)",
      "Sınırsız fiyat geçmişi",
      "Tüm bildirim kanalları",
      "API erişimi",
      "Özel entegrasyonlar",
      "Dedicated destek",
    ],
    highlighted: false,
  },
];

export function getPlanById(planId: string): PlanInfo | undefined {
  return PLANS.find((p) => p.id === planId);
}

export function isUpgrade(currentPlan: string, targetPlan: string): boolean {
  const order = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
  return order.indexOf(targetPlan) > order.indexOf(currentPlan);
}

// Map Whop plan IDs back to CompeteHive plan IDs
export function getCompeteHivePlanByWhopId(whopPlanId: string): string {
  for (const plan of PLANS) {
    if (plan.whopPlanId === whopPlanId || plan.whopYearlyPlanId === whopPlanId) {
      return plan.id;
    }
  }
  return "FREE"; // fallback
}

// Get plan limits by plan ID
export function getPlanLimits(planId: string): { maxProducts: number; scrapeInterval: number } {
  switch (planId) {
    case "STARTER":
      return { maxProducts: 50, scrapeInterval: 60 };
    case "PRO":
      return { maxProducts: 500, scrapeInterval: 15 };
    case "ENTERPRISE":
      return { maxProducts: 99999, scrapeInterval: 5 };
    default:
      return { maxProducts: 5, scrapeInterval: 1440 };
  }
}
