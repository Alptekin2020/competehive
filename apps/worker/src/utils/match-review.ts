// ============================================
// Kullanıcı onaylı eşleştirme ("olası eşleşmeler")
// ============================================
//
// AI eşleştirici bilerek katıdır: yanlış bir rakip, fiyat önerisini ve
// "rakip ucuz" alarmını bozar. Bedeli, aynı ürünün sık sık reddedilmesi ve
// kullanıcının "rakip bulunamadı" görmesiydi (prod 14 Kasım: 10 üründen 6'sı
// rakipsiz). Satıcı ise ürününü AI'dan iyi tanır.
//
// Çözüm: AI'ın emin olamadığı (CANDIDATE_MIN_SCORE ≤ skor < MIN_MATCH_SCORE)
// adaylar atılmaz; "onay bekleyen olası eşleşme" olarak saklanır. Skoru düşük
// kaldığı için karar hesaplarına (pozisyon, öneri, alarm) GİRMEZ; kullanıcı
// "Bu aynı ürün" derse skor 100 olur ve girer, "değil" derse URL ürünün
// reddedilenler listesine yazılır ve keşif onu bir daha getirmez.
//
// Web aynası: apps/web/src/lib/match-review.ts (sabitler ve alan adları aynı
// kalmalı — worker'ın Docker context'i paylaşılan paketi import edemez).

import { MIN_MATCH_SCORE } from "./competitor-quality";
import { competitorUrlKey } from "./url-match";

/** Bu skorun altındaki retler gerçekten farklı üründür; saklanmaz. */
export const CANDIDATE_MIN_SCORE = 50;

/** Bir keşif turunda ürün başına en fazla bu kadar yeni aday saklanır. */
export const MAX_NEW_CANDIDATES_PER_ROUND = 5;

/** Ürün başına bekleyen aday üst sınırı — kullanıcıyı onay yığınına boğma. */
export const MAX_PENDING_CANDIDATES = 8;

export type MatchReview = "pending" | "confirmed";

/** matchAttributes JSON'undaki kullanıcı onay durumu (yoksa null). */
export function readMatchReview(matchAttributes: unknown): MatchReview | null {
  if (!matchAttributes || typeof matchAttributes !== "object") return null;
  const review = (matchAttributes as Record<string, unknown>).review;
  return review === "pending" || review === "confirmed" ? review : null;
}

/**
 * AI'ın reddettiği aday, kullanıcı onayına sunulmaya değer mi? AI hiç
 * çalışmadıysa (anahtar yok / API hatası) skor güvenilmezdir — saklanmaz.
 */
export function shouldKeepAsCandidate(match: {
  isMatch: boolean;
  score: number;
  aiUnavailable?: boolean;
}): boolean {
  if (match.isMatch || match.aiUnavailable) return false;
  return match.score >= CANDIDATE_MIN_SCORE && match.score < MIN_MATCH_SCORE;
}

/**
 * Ürün metadata'sındaki kullanıcının "bu aynı ürün değil" dediği rakip
 * URL'lerini eşleştirme anahtarına (competitorUrlKey) çevirir.
 */
export function readRejectedUrlKeys(metadata: unknown): Set<string> {
  if (!metadata || typeof metadata !== "object") return new Set();
  const raw = (metadata as Record<string, unknown>).rejectedCompetitorUrls;
  if (!Array.isArray(raw)) return new Set();
  const keys = raw
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => competitorUrlKey(value))
    .filter(Boolean);
  return new Set(keys);
}
