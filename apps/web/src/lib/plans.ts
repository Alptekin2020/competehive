export interface PlanInfo {
  id: string;
  name: string;
  price: number; // Monthly in TRY
  yearlyPrice: number; // Monthly price when billed yearly
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
