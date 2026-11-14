// ============================================
// İkinci rakip kaynağı — ne zaman ve ne kadar
// ============================================
//
// Birinci kaynak Google Shopping'dir (fiyatlı, ucuz). İkinci kaynak pazaryeri
// ürün sayfalarının Google web aramasıdır (serper.ts → searchMarketplacePages):
// daha geniş kapsar ama sonuçlar fiyatsız gelir ve fiyat için doğrudan tarama
// (Puppeteer'a kadar gidebilen zincir) gerekir. Bu yüzden yalnızca ürünün
// rakip sayısı azken devreye girer ve tur başına tarama sayısı sınırlıdır.

/** Güvenilir rakip sayısı bunun altındaysa ikinci kaynak da aranır. */
export const MIN_COMPETITORS_BEFORE_SECOND_SOURCE = 5;

/** Bir keşif turunda en fazla bu kadar doğrudan fiyat taraması kuyruğa alınır. */
export const MAX_DIRECT_SCRAPES_PER_ROUND = 4;

/**
 * @param savedThisRound Bu turda Shopping'den kaydedilen/güncellenen rakip sayısı
 * @param trustedKnown   Ürünün önceden bilinen (onay bekleyenler hariç) rakip sayısı
 */
export function shouldSearchMarketplacePages(
  savedThisRound: number,
  trustedKnown: number,
): boolean {
  return Math.max(savedThisRound, trustedKnown) < MIN_COMPETITORS_BEFORE_SECOND_SOURCE;
}
