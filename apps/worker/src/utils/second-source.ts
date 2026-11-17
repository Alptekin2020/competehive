// ============================================
// İkinci rakip kaynağı — ne zaman ve ne kadar
// ============================================
//
// Birinci kaynak Google Shopping'dir (fiyatlı, ucuz). İkinci kaynak pazaryeri
// ürün sayfalarının Google web aramasıdır (serper.ts → searchMarketplacePages):
// daha geniş kapsar ama sonuçlar fiyatsız gelir ve fiyat için doğrudan tarama
// (Puppeteer'a kadar gidebilen zincir) gerekir. Bu yüzden yalnızca ürünün
// rakip sayısı azken devreye girer ve tur başına tarama sayısı sınırlıdır.

import {
  COMPETITOR_STALE_HOURS,
  isPendingReview,
  MIN_MATCH_SCORE,
  readCompetitorDeadAt,
} from "./competitor-quality";
import { isGoogleHostedUrl } from "./stale-competitors";

/** Taze ve doğrudan taranabilir güvenilir rakip sayısı bunun altındaysa ikinci kaynak da aranır. */
export const MIN_COMPETITORS_BEFORE_SECOND_SOURCE = 5;

/** Bir keşif turunda en fazla bu kadar doğrudan fiyat taraması kuyruğa alınır. */
export const MAX_DIRECT_SCRAPES_PER_ROUND = 4;

/**
 * @param savedThisRound Bu turda kaydedilen/güncellenen, Google kartı OLMAYAN rakip sayısı
 * @param trustedKnown   Önceden bilinen taze ve taranabilir güvenilir rakip sayısı
 *                       (countFreshDirectCompetitors)
 */
export function shouldSearchMarketplacePages(
  savedThisRound: number,
  trustedKnown: number,
): boolean {
  return Math.max(savedThisRound, trustedKnown) < MIN_COMPETITORS_BEFORE_SECOND_SOURCE;
}

export interface SecondSourceKnownRow {
  competitorUrl: string;
  matchScore: number | null;
  matchAttributes: unknown;
  lastScrapedAt: Date | null;
}

/**
 * İkinci kaynak eşiği için sayılan rakipler: güvenilir (onay beklemiyor, skor
 * null ya da ≥ MIN_MATCH_SCORE, ölü değil), son 72 saatte fiyatlanmış ve Google
 * kartı olmayan satırlar. Prod 17 Kasım: EP3347'nin 34 güvenilir rakibinin 29'u
 * bayat Google kartıydı; hepsi sayıldığı için ikinci kaynak hiç çalışmıyor,
 * taranabilir pazaryeri sayfaları hiç aranmıyordu.
 */
export function countFreshDirectCompetitors(
  rows: SecondSourceKnownRow[],
  now: Date,
  staleHours: number = COMPETITOR_STALE_HOURS,
): number {
  const cutoff = now.getTime() - staleHours * 60 * 60 * 1000;
  return rows.filter(
    (r) =>
      !isPendingReview(r.matchAttributes) &&
      (r.matchScore === null || r.matchScore >= MIN_MATCH_SCORE) &&
      !readCompetitorDeadAt(r.matchAttributes) &&
      !isGoogleHostedUrl(r.competitorUrl) &&
      r.lastScrapedAt !== null &&
      r.lastScrapedAt.getTime() >= cutoff,
  ).length;
}
