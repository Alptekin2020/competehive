// ============================================
// Kullanıcı onaylı eşleştirme ("olası eşleşmeler") — web tarafı
// ============================================
//
// Worker aynası: apps/worker/src/utils/match-review.ts. Alan adları
// (matchAttributes.review, metadata.rejectedCompetitorUrls) iki tarafta aynı
// kalmalı. AI'ın emin olamadığı adaylar "pending" olarak saklanır; kullanıcı
// onaylarsa skor 100 olur ve karar hesaplarına girer, reddederse URL ürünün
// reddedilenler listesine yazılır ve keşif onu bir daha getirmez.

export type MatchReview = "pending" | "confirmed";

/** Kullanıcı onayıyla verilen skor — kalite politikasında "güvenilir" bandı. */
export const USER_CONFIRMED_SCORE = 100;
export const USER_CONFIRMED_REASON = "Aynı ürün olduğunu siz onayladınız";

/** Ürün başına saklanan reddedilmiş rakip URL'si üst sınırı (en eskiler düşer). */
export const MAX_REJECTED_URLS = 300;

export function readMatchReview(matchAttributes: unknown): MatchReview | null {
  if (!matchAttributes || typeof matchAttributes !== "object") return null;
  const review = (matchAttributes as Record<string, unknown>).review;
  return review === "pending" || review === "confirmed" ? review : null;
}

/** Mevcut matchAttributes'ı koruyarak onay durumunu yazar. */
export function withMatchReview(
  matchAttributes: unknown,
  review: MatchReview,
): Record<string, unknown> {
  const base =
    matchAttributes && typeof matchAttributes === "object" && !Array.isArray(matchAttributes)
      ? (matchAttributes as Record<string, unknown>)
      : {};
  return { ...base, review };
}

/**
 * Ürün metadata'sına reddedilen rakip URL'sini ekler (mükerrer yazmaz, diğer
 * metadata alanlarına dokunmaz, listeyi MAX_REJECTED_URLS ile sınırlar).
 */
export function addRejectedCompetitorUrl(metadata: unknown, url: string): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const existing = Array.isArray(base.rejectedCompetitorUrls)
    ? base.rejectedCompetitorUrls.filter((v): v is string => typeof v === "string")
    : [];
  if (existing.includes(url)) return { ...base, rejectedCompetitorUrls: existing };
  return {
    ...base,
    rejectedCompetitorUrls: [...existing, url].slice(-MAX_REJECTED_URLS),
  };
}
