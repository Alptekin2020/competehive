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
  /**
   * Fiyatın geldiği kaynak (satıcı değil): Google bağlantılarında küçük
   * "Google Alışveriş" etiketi olarak gösterilir.
   */
  sourceLabel?: string;
}

export const GOOGLE_SHOPPING_LABEL = "Google Alışveriş";
export const UNKNOWN_SELLER_LABEL = "Satıcı bilinmiyor";
export const GOOGLE_SEARCH_LABEL = "Google'da ara";

// Google'ın kendisi satıcı değildir: worker bazen kaynak alanına "Google"
// yazabiliyor; bunlar "satıcı bilinmiyor" sayılır.
const GOOGLE_SELLER_NAMES = new Set([
  "google",
  "google alışveriş",
  "google shopping",
  "google.com",
]);

function knownSeller(seller: string | null | undefined): string | null {
  const trimmed = seller?.trim();
  if (!trimmed) return null;
  if (GOOGLE_SELLER_NAMES.has(trimmed.toLocaleLowerCase("tr-TR"))) return null;
  return trimmed;
}

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
 * - Google bağlantısı, satıcı bilinmiyor → "Satıcı bilinmiyor" (Google satıcı
 *   değildir; ne "google.com" ne "Google Alışveriş" satıcı olarak yazılır),
 * - diğer alan adları → alan adından türetilen ad.
 * Google bağlantılarında kaynak ayrıca `sourceLabel` ("Google Alışveriş") olarak döner.
 */
export function resolveCompetitorSource(input: CompetitorSourceInput): CompetitorSourceBadge {
  const viaGoogle = isGoogleHostedUrl(input.competitorUrl);
  const sourceLabel = viaGoogle ? GOOGLE_SHOPPING_LABEL : undefined;
  if (input.marketplace !== "CUSTOM") {
    return { marketplace: input.marketplace, viaGoogle, ...(sourceLabel ? { sourceLabel } : {}) };
  }
  if (viaGoogle) {
    const seller = knownSeller(input.seller);
    return {
      marketplace: "CUSTOM",
      overrideName: seller ?? UNKNOWN_SELLER_LABEL,
      // Bilinmeyen satıcı nötr gri; bilinen satıcı CUSTOM rengini kullanır.
      ...(seller ? {} : { overrideColor: "#9CA3AF" }),
      viaGoogle: true,
      sourceLabel: GOOGLE_SHOPPING_LABEL,
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

export interface CompetitorLinkInput {
  competitorUrl: string;
  competitorName?: string | null;
  seller?: string | null;
}

/**
 * Rakip bağlantısının açılacağı adres. Google'ın ürün kartları
 * (google.com/search?ibp=oshop…&prds=…) kısa sürede ölür ("Bu ürünle ilgili
 * ayrıntı yok"); bu yüzden asla ham kart açılmaz, yerine ürün adı + satıcı ile
 * taze bir Google Alışveriş araması açılır. Gerçek pazaryeri/mağaza
 * bağlantıları doğrudan açılır.
 */
export function competitorOpenUrl(competitor: CompetitorLinkInput): string {
  if (!isGoogleHostedUrl(competitor.competitorUrl)) return competitor.competitorUrl;
  const query = [competitor.competitorName?.trim(), knownSeller(competitor.seller)]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const params = new URLSearchParams({ udm: "28", gl: "tr", hl: "tr" });
  const base = `https://www.google.com/search?${params.toString()}`;
  return query ? `${base}&q=${encodeURIComponent(query)}` : base;
}

/** Bağlantının etiketi/ipucu: Google'da arama mı, satıcı sayfası mı. */
export function competitorOpenLabel(competitor: CompetitorLinkInput): string {
  return isGoogleHostedUrl(competitor.competitorUrl) ? GOOGLE_SEARCH_LABEL : "Rakip ürüne git";
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
