// ============================================
// Ürün detayındaki rakip grupları, sayaçlar ve grafik görünürlüğü
// ============================================
//
// Ürün sayfası rakipleri üç gruba ayırır:
//   1. Güvenilir rakipler (numaralı, karar hesaplarına giren),
//   2. "Diğer rakipler" (kalite politikasından geçemeyen: düşük skor, bant
//      dışı, eski, piyasa dışı — varsayılan kapalı),
//   3. "Onay bekleyen olası eşleşmeler" (matchAttributes.review === "pending").
// Onay bekleyen kayıtlar numaralı listede, sayaçlarda, karar hesaplarında ve
// grafikte asla yer almaz; kullanıcı onaylayana kadar yalnızca kendi grubunda
// görünür. Uykudaki (30+ gün fiyatsız) otomatik kayıtlar da sayaçlara ve
// grafiğe girmez.

import type {
  CompetitorAssessment,
  CompetitorAssessmentInput,
  MatchBasis,
} from "@competehive/shared";

import { isDormantCompetitor } from "./competitor-source";

export interface GroupableCompetitor {
  id: string;
  currentPrice: string | number | null;
  matchScore: number | null;
  lastScrapedAt: string | Date | null;
  createdAt?: string | Date | null;
  review?: "pending" | "confirmed" | null;
  deadAt?: string | null;
  matchBasis?: MatchBasis | null;
}

export function isPendingReview(competitor: { review?: string | null }): boolean {
  return competitor.review === "pending";
}

function parsePrice(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Karar hesaplarına (piyasa pozisyonu, fiyat önerisi, akran medyanı) girecek
 * rakiplerin kalite politikası girdileri. Onay bekleyen kayıtlar BU katmanda
 * elenir: skorları zaten eşiğin altında olsa da akran medyanını ve "şüpheli"
 * sayacını etkilememeleri için politikaya hiç verilmezler.
 */
export function decisionCandidates<T extends GroupableCompetitor>(
  competitors: T[],
): { competitors: T[]; inputs: CompetitorAssessmentInput[] } {
  const eligible = competitors.filter((c) => !isPendingReview(c));
  return {
    competitors: eligible,
    inputs: eligible.map((c) => ({
      price: parsePrice(c.currentPrice),
      matchScore: c.matchScore ?? null,
      lastScrapedAt: c.lastScrapedAt,
      deadAt: c.deadAt ?? null,
      review: c.review ?? null,
      matchBasis: c.matchBasis ?? null,
    })),
  };
}

export interface CompetitorGroups<T> {
  /** Karar hesaplarına giren rakipler (numaralı liste). */
  trusted: T[];
  /** Politikadan geçemeyen, onay beklemeyen rakipler ("Diğer rakipler"). */
  other: T[];
  /** Kullanıcı onayı bekleyen olası eşleşmeler. */
  pending: T[];
  /** Gizlenen (veya showDormant ile "Diğer"e eklenen) uykudaki kayıt sayısı. */
  dormantCount: number;
}

/**
 * Rakipleri üç gruba ayırır. Sıralama girdinin sırasını korur (çağıran
 * önceden sıralar). Uykudaki kayıtlar yalnızca `showDormant` açıkken "Diğer"
 * grubuna girer; onay bekleyen kayıtlar uykuda olsa da kendi grubunda kalır
 * (kullanıcı karar verebilsin).
 */
export function groupCompetitors<T extends GroupableCompetitor>(
  competitors: T[],
  assessments: Map<string, CompetitorAssessment>,
  options: { showDormant?: boolean; now?: Date } = {},
): CompetitorGroups<T> {
  const now = options.now ?? new Date();
  const groups: CompetitorGroups<T> = { trusted: [], other: [], pending: [], dormantCount: 0 };
  for (const competitor of competitors) {
    if (isPendingReview(competitor)) {
      groups.pending.push(competitor);
      continue;
    }
    if (assessments.get(competitor.id)?.usable === true) {
      groups.trusted.push(competitor);
      continue;
    }
    if (isDormantCompetitor(dormantInput(competitor), now)) {
      groups.dormantCount += 1;
      if (!options.showDormant) continue;
    }
    groups.other.push(competitor);
  }
  return groups;
}

function dormantInput(c: GroupableCompetitor) {
  return {
    lastScrapedAt: c.lastScrapedAt,
    createdAt: c.createdAt ?? null,
    matchScore: c.matchScore,
    review: c.review ?? null,
  };
}

export interface CompetitorCounts {
  /** Güncel rakip sayısı: onay bekleyen ve uykudaki kayıtlar hariç. */
  current: number;
  pending: number;
  dormant: number;
}

export function countCompetitors(
  competitors: GroupableCompetitor[],
  now: Date = new Date(),
): CompetitorCounts {
  let pending = 0;
  let dormant = 0;
  for (const c of competitors) {
    if (isPendingReview(c)) pending += 1;
    else if (isDormantCompetitor(dormantInput(c), now)) dormant += 1;
  }
  return { current: competitors.length - pending - dormant, pending, dormant };
}

/** Güncel (onay beklemeyen, uykuda olmayan) rakipler. */
export function currentCompetitors<T extends GroupableCompetitor>(
  competitors: T[],
  now: Date = new Date(),
): T[] {
  return competitors.filter(
    (c) => !isPendingReview(c) && !isDormantCompetitor(dormantInput(c), now),
  );
}

/**
 * Grafikte (fiyat çizgileri ve olay işaretleri) gösterilmeyecek rakipler:
 * onay bekleyen ve uykudaki kayıtlar.
 */
export function chartHiddenCompetitorIds(
  competitors: GroupableCompetitor[],
  now: Date = new Date(),
): Set<string> {
  const hidden = new Set<string>();
  for (const c of competitors) {
    if (isPendingReview(c) || isDormantCompetitor(dormantInput(c), now)) hidden.add(c.id);
  }
  return hidden;
}

export interface CompetitorPointWithId {
  competitorId: string;
  price: unknown;
  scrapedAt: Date;
}

function pointKey(price: unknown, scrapedAt: Date): string {
  return `${scrapedAt.getTime()}|${Number(price).toFixed(2)}`;
}

/**
 * price_history satırlarından grafikte gizlenecek olanları işaretler (girdi
 * sırasıyla). Rakip satırının sahibi competitor_prices ikizinden (aynı an +
 * aynı tutar) bulunur; ikizlerinin TAMAMI gizli rakiplere aitse satır gizlenir.
 * Kendi fiyat satırları asla gizlenmez.
 */
export function chartHiddenHistoryFlags(
  rows: Array<{ price: unknown; scrapedAt: Date }>,
  isOwn: boolean[],
  competitorPoints: CompetitorPointWithId[],
  hiddenIds: Set<string>,
): boolean[] {
  if (hiddenIds.size === 0) return rows.map(() => false);
  const owners = new Map<string, Set<string>>();
  for (const point of competitorPoints) {
    const key = pointKey(point.price, point.scrapedAt);
    const set = owners.get(key) ?? new Set<string>();
    set.add(point.competitorId);
    owners.set(key, set);
  }
  return rows.map((row, index) => {
    if (isOwn[index]) return false;
    const ids = owners.get(pointKey(row.price, row.scrapedAt));
    if (!ids || ids.size === 0) return false;
    return [...ids].every((id) => hiddenIds.has(id));
  });
}

// ============================================
// Nötr fiyat farkı metni (onay bekleyen / diğer kartlar)
// ============================================

/** Bu oranın (büyük/küçük) üstündeki farkta onay ek bir adım ister (%50). */
export const LARGE_PRICE_GAP_RATIO = 1.5;
/** Bu oranın üstünde fark "%X" yerine "N kat" olarak yazılır. */
const MULTIPLE_GAP_RATIO = 2;

export interface PriceGap {
  /** "Fiyat farkı 2,7 kat", "%35 daha pahalı", "%20 daha ucuz", "Aynı fiyat". */
  text: string;
  /** büyük / küçük fiyat oranı (≥ 1). */
  ratio: number;
  /** Fark %50'den büyük: onay ekstra bir doğrulama adımı ister. */
  isLarge: boolean;
}

function formatTr(value: number, digits: number): string {
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Rakip fiyatının sizin fiyatınıza göre farkını nötr bir dille anlatır
 * (renkli/işaretli yüzde yerine). Fiyatlardan biri yoksa null döner.
 */
export function describePriceGap(
  competitorPrice: number | null,
  ownPrice: number | null,
): PriceGap | null {
  if (competitorPrice === null || ownPrice === null) return null;
  if (!(competitorPrice > 0) || !(ownPrice > 0)) return null;
  const high = Math.max(competitorPrice, ownPrice);
  const low = Math.min(competitorPrice, ownPrice);
  const ratio = high / low;
  const isLarge = ratio > LARGE_PRICE_GAP_RATIO;
  if (ratio >= MULTIPLE_GAP_RATIO) {
    return { text: `Fiyat farkı ${formatTr(ratio, 1)} kat`, ratio, isLarge };
  }
  const pct = (Math.abs(competitorPrice - ownPrice) / ownPrice) * 100;
  if (pct < 0.05) return { text: "Aynı fiyat", ratio, isLarge };
  const direction = competitorPrice > ownPrice ? "daha pahalı" : "daha ucuz";
  return { text: `%${formatTr(pct, pct < 10 ? 1 : 0)} ${direction}`, ratio, isLarge };
}

// ============================================
// Tek tazelik etiketi
// ============================================

export type FreshnessTone = "fresh" | "aging" | "stale";

export interface CompetitorFreshness {
  /** "az önce", "5 dk önce", "3 sa önce", "1 gün önce". */
  label: string;
  tone: FreshnessTone;
  title: string;
}

/**
 * Rakip fiyatının ne zaman alındığını TEK etiketle anlatır (eskiden "1 gün
 * önce" ve "32sa" yan yana iki etiket çıkıyordu). Renk tonu 24/72 saat
 * eşikleriyle belirlenir.
 */
export function competitorFreshness(
  lastScrapedAt: string | Date | null,
  now: Date = new Date(),
): CompetitorFreshness | null {
  if (!lastScrapedAt) return null;
  const time = new Date(lastScrapedAt).getTime();
  if (!Number.isFinite(time)) return null;
  const diffMin = Math.max(0, Math.floor((now.getTime() - time) / 60000));
  const hours = diffMin / 60;
  const label =
    diffMin < 1
      ? "az önce"
      : diffMin < 60
        ? `${diffMin} dk önce`
        : hours < 24
          ? `${Math.floor(hours)} sa önce`
          : `${Math.floor(hours / 24)} gün önce`;
  if (hours > 72) {
    return {
      label,
      tone: "stale",
      title: "Bu fiyat 72 saatten önce alındı; güncel olmayabilir ve hesaplara girmez",
    };
  }
  if (hours > 24) {
    return { label, tone: "aging", title: "Bu fiyat 24 saatten önce alındı" };
  }
  return { label, tone: "fresh", title: "Fiyat son 24 saat içinde alındı" };
}
