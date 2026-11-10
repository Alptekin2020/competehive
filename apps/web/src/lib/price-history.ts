// ============================================
// Fiyat geçmişi satırlarında "kendi fiyat" / "rakip fiyatı" ayrımı
// ============================================
//
// price_history tablosu hem ürünün KENDİ fiyat satırlarını hem de rakip fiyat
// satırlarını tutar; ayrım için kolon yoktur, yalnızca sellerName vardır.
// Grafik eskiden sellerName içinde pazaryeri ENUM anahtarını ("AMAZON_TR")
// arıyordu; bu yüzden:
//   - elle girilen fiyat ("Elle girildi") ve mağaza adıyla yazılan kendi
//     satırları RAKİP sayılıyor, "Benim Fiyatım" çizgisi boş kalıyordu;
//   - "Amazon TR" / kendi-site ürünlerinde kendi fiyat hiç eşleşmiyordu;
//   - aynı pazaryerindeki rakip ("Trendyol") KENDİ fiyat sanılıyordu.
//
// Güvenilir sinyal: worker her rakip fiyatını aynı anda (aynı `scrapedAt`,
// aynı tutar) competitor_prices tablosuna da yazar; kendi satırların orada
// ikizi yoktur. Sınıflandırma bu ikiz eşleşmesini, yalnızca kendi-fiyat
// yollarının doldurduğu alanları ve satıcı adı ipuçlarını birlikte kullanır.

/** Yalnızca kendi-fiyat yollarının yazdığı satıcı adları. */
export const OWN_SELLER_MARKERS = ["Benim Ürünüm", "Kendi Mağazam", "Elle girildi"] as const;

export interface PriceHistoryRowLike {
  price: unknown;
  previousPrice: unknown;
  priceChange: unknown;
  sellerName: string | null;
  scrapedAt: Date;
}

export interface CompetitorPricePoint {
  price: unknown;
  scrapedAt: Date;
}

export interface OwnPriceContext {
  /** Ürünün rakiplerine ait competitor_prices satırları (aynı zaman penceresi). */
  competitorPoints: CompetitorPricePoint[];
  /**
   * Kendi satırların taşıyabileceği satıcı adları: ürünün kayıtlı satıcı adı ve
   * ürün URL'sinin pazaryeri görünen adı ("Trendyol", "Amazon TR").
   */
  ownSellerNames: Array<string | null | undefined>;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function pointKey(price: unknown, scrapedAt: Date): string {
  return `${scrapedAt.getTime()}|${Number(price).toFixed(2)}`;
}

const NORMALIZED_MARKERS = new Set(OWN_SELLER_MARKERS.map((marker) => normalizeName(marker)));

/**
 * Her satır için "bu, ürünün kendi fiyatı mı?" sorusunu yanıtlar (girdi sırasıyla).
 *
 *   - Kesin kendi: kendi-fiyat işaretli satıcı adı ya da previousPrice/priceChange
 *     dolu (bu alanları yalnızca kendi-fiyat tarama yolu yazar).
 *   - Rakip: competitor_prices'ta ikizi olan satır.
 *   - Muhtemel kendi (ikizi yoksa): satıcı adı boş ya da ürünün kendi
 *     satıcı/pazaryeri adına eşit.
 *   - Diğer her şey rakip (ör. silinmiş bir rakibin eski satırları).
 *
 * İkizler önce kendi-ipucu TAŞIMAYAN satırlara dağıtılır: kendi fiyat ile bir
 * rakip aynı anda aynı tutardaysa kendi satır yanlışlıkla rakip sayılmaz.
 */
export function classifyOwnPriceHistory(
  rows: PriceHistoryRowLike[],
  context: OwnPriceContext,
): boolean[] {
  const remainingTwins = new Map<string, number>();
  for (const point of context.competitorPoints) {
    const key = pointKey(point.price, point.scrapedAt);
    remainingTwins.set(key, (remainingTwins.get(key) ?? 0) + 1);
  }

  const ownNames = new Set(
    context.ownSellerNames.map((name) => normalizeName(name)).filter((name) => name.length > 0),
  );

  type Hint = "definite" | "likely" | "none";
  const hints: Hint[] = rows.map((row) => {
    const seller = normalizeName(row.sellerName);
    if (NORMALIZED_MARKERS.has(seller) || row.previousPrice != null || row.priceChange != null) {
      return "definite";
    }
    if (seller.length === 0 || ownNames.has(seller)) return "likely";
    return "none";
  });

  const consumeTwin = (row: PriceHistoryRowLike): boolean => {
    const key = pointKey(row.price, row.scrapedAt);
    const left = remainingTwins.get(key) ?? 0;
    if (left <= 0) return false;
    remainingTwins.set(key, left - 1);
    return true;
  };

  const isOwn: boolean[] = new Array(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (hints[index] === "definite") isOwn[index] = true;
    else if (hints[index] === "none") consumeTwin(row);
  });
  rows.forEach((row, index) => {
    if (hints[index] === "likely") isOwn[index] = !consumeTwin(row);
  });

  return isOwn;
}
