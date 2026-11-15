// ============================================
// Rakibin gerçek kaynağı (rozet) ve uykudaki kayıtlar
// ============================================
//
// Google Alışveriş sonuçlarının bir kısmı satıcının sayfasına değil Google'ın
// kendi ürün kartına bağlanır. Rozet alan adından üretilince bu rakipler
// "google.com" olarak görünüyordu; oysa fiyatı veren gerçek satıcı worker'ın
// matchAttributes.seller alanına yazdığı addır (bkz. lib/match-review.ts).

import { getRetailerInfoFromDomain } from "@competehive/shared";

export interface CompetitorSourceInput {
  marketplace: string;
  competitorUrl: string;
  /** Worker'ın kaydettiği gerçek satıcı adı (Google bağlantılarında). */
  seller?: string | null;
}

export interface CompetitorSourceBadge {
  /** MarketplaceBadge'e verilecek pazaryeri anahtarı. */
  marketplace: string;
  overrideName?: string;
  overrideColor?: string;
  /** Bağlantı satıcının sayfasına değil Google'ın ürün kartına gidiyor. */
  viaGoogle: boolean;
}

export const GOOGLE_SHOPPING_LABEL = "Google Alışveriş";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isGoogleHostedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(^|\.)google\.[a-z.]+$/.test(hostOf(url));
}

/**
 * Rakip satırının rozetini belirler:
 * - bilinen pazaryeri (TRENDYOL…) → kendi rozeti,
 * - Google bağlantısı + satıcı adı → satıcının adı ("Evkur"),
 * - Google bağlantısı, satıcı bilinmiyor → "Google Alışveriş" ("google.com" değil),
 * - diğer alan adları → alan adından türetilen ad.
 */
export function resolveCompetitorSource(input: CompetitorSourceInput): CompetitorSourceBadge {
  const viaGoogle = isGoogleHostedUrl(input.competitorUrl);
  if (input.marketplace !== "CUSTOM") {
    return { marketplace: input.marketplace, viaGoogle };
  }
  if (viaGoogle) {
    const seller = input.seller?.trim();
    return {
      marketplace: "CUSTOM",
      overrideName: seller || GOOGLE_SHOPPING_LABEL,
      viaGoogle: true,
    };
  }
  const host = hostOf(input.competitorUrl);
  const info = host ? getRetailerInfoFromDomain(host) : null;
  return {
    marketplace: "CUSTOM",
    overrideName: info?.retailerName || "Diğer",
    overrideColor: info?.retailerColor,
    viaGoogle: false,
  };
}

/** Bu kadar gündür fiyatı güncellenmeyen otomatik kayıt "uykuda" sayılır. */
export const DORMANT_COMPETITOR_DAYS = 30;

export interface DormantCheckInput {
  lastScrapedAt: string | Date | null;
  createdAt?: string | Date | null;
  matchScore: number | null;
  review?: "pending" | "confirmed" | null;
}

/**
 * Uzun süredir fiyatı alınamayan OTOMATİK rakip kaydı mı? Bu kayıtlar zaten
 * hesaplara girmez (72 saat kuralı); listede ve "N rakip" sayısında durmaları
 * güncel rakip sayısını olduğundan büyük gösterir. Elle eklenen (skor null) ve
 * kullanıcının onayladığı kayıtlar asla uykuda sayılmaz.
 */
export function isDormantCompetitor(input: DormantCheckInput, now: Date = new Date()): boolean {
  if (input.matchScore === null || input.review === "confirmed") return false;
  const reference = input.lastScrapedAt ?? input.createdAt ?? null;
  if (!reference) return false;
  const time = new Date(reference).getTime();
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time > DORMANT_COMPETITOR_DAYS * 24 * 60 * 60 * 1000;
}
