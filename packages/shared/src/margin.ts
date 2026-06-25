// ============================================
// Kâr marjı politikası — maliyet & marj hesapları
// ============================================
//
// Satıcının birim maliyeti (COGS) girildiğinde uygulama "rakip kaça satıyor?"
// sorusunun ötesine geçip "bu fiyata satarsam ne kazanırım, zarar mı ediyorum?"
// sorusunu yanıtlar. Bu modül kâr/marj matematiğinin tek kaynağıdır (web).
//
// Worker tarafı aynı formülü satır içi kullanır: Docker build context'i
// @competehive/shared'ı import edemez (competitor-quality / normalize-product-
// image ile aynı kısıt). Formül tek bölme olduğu için orada ayrı bir mirror
// modül tutmak yerine processor.ts içinde inline hesaplanır — bu iki yer marj
// formülünü değiştirirken birlikte güncellenmelidir.

// Marj bandı eşikleri (%). UI rozet renkleri ve "sağlıklı / ince" etiketleri için.
export const THIN_MARGIN_PCT = 10;
export const HEALTHY_MARGIN_PCT = 25;

export type MarginBand = "loss" | "thin" | "healthy" | "strong";

export interface MarginResult {
  /** Birim kâr (TL): price - cost. Negatif değer zarar demektir. */
  profit: number;
  /** Kâr marjı (%): profit / price * 100. */
  marginPct: number;
  /** Marjın kalite bandı (rozet/etiket için). */
  band: MarginBand;
}

/**
 * Marj yüzdesini kalite bandına eşler. Negatif marj = zarar.
 */
export function marginBand(marginPct: number): MarginBand {
  if (marginPct < 0) return "loss";
  if (marginPct < THIN_MARGIN_PCT) return "thin";
  if (marginPct < HEALTHY_MARGIN_PCT) return "healthy";
  return "strong";
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Satış fiyatı ve maliyetten birim kâr (TL) + marj (%) döndürür.
 *
 * Maliyet veya fiyat geçersizse null döner (maliyet girilmemiş, fiyat ≤ 0 ya da
 * maliyet < 0). Böylece "maliyet yok → marj gösterme" durumu çağıranlarda tek
 * bir koşulla ele alınır. Prisma Decimal değerleri string gelebildiği için
 * string girdi de kabul edilir.
 */
export function computeMargin(
  price: number | string | null | undefined,
  cost: number | string | null | undefined,
): MarginResult | null {
  const p = toFiniteNumber(price);
  const c = toFiniteNumber(cost);
  if (p === null || c === null) return null;
  if (p <= 0 || c < 0) return null;
  const profit = p - c;
  const marginPct = (profit / p) * 100;
  return { profit, marginPct, band: marginBand(marginPct) };
}

/**
 * Hedef marjı korumak için gereken en düşük satış fiyatı (marj tabanı):
 *   marginPct = (price - cost) / price  ⇒  price = cost / (1 - marginPct/100)
 *
 * "Rakibin altına in" önerisini bu tabanla kıyaslayıp satıcının zarar etmesini
 * engellemek için kullanılır. marginPct ≥ 100 matematiksel olarak imkânsızdır
 * (fiyat sonsuza gider) → null. Maliyet geçersizse → null.
 */
export function priceForMargin(
  cost: number | string | null | undefined,
  marginPct: number,
): number | null {
  const c = toFiniteNumber(cost);
  if (c === null || c < 0) return null;
  const m = marginPct / 100;
  if (m >= 1) return null;
  return c / (1 - m);
}
