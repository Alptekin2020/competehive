// ============================================
// Merkezi tr-TR sayı/para/yüzde formatlayıcıları
// ============================================
//
// Fiyat gösterimi sayfadan sayfaya değişiyordu: kart görünümü "₺350,00",
// tablo "₺350", detay başlığı "₺2.158" (kuruş sessizce düşüyor), rozetlerde
// "₺349,9". Kullanıcının gördüğü HER fiyat buradan geçmeli ki tek biçim olsun:
// binlik ayracı nokta, ondalık virgül, İKİ haneli kuruş.

const TRY_CURRENCY = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PLAIN_NUMBER: Record<number, Intl.NumberFormat> = {};

/** ₺1.299,90 biçiminde para. null/undefined/NaN → "—". */
export function formatTRY(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || !Number.isFinite(n)) return "—";
  return TRY_CURRENCY.format(n);
}

/** 1.299,9 gibi sade sayı (birimsiz). */
export function formatNumberTR(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fmt = (PLAIN_NUMBER[digits] ??= new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }));
  return fmt.format(value);
}

/** %4,5 biçiminde yüzde (Türkçe ondalık virgül; işaret istenirse dahil edilir). */
export function formatPctTR(
  value: number | null | undefined,
  opts: { digits?: number; sign?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = opts.digits ?? 1;
  const body = formatNumberTR(Math.abs(value), digits);
  const sign = opts.sign ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  return `${sign}%${body}`;
}

/**
 * Kullanıcının yazdığı tutarı sayıya çevirir (fiyat/maliyet alanları).
 *
 * Türkçe yazımda nokta BİNLİK, virgül ONDALIK ayracıdır: "2.499" = 2499,
 * "1.499,90" = 1499.9. Ham `Number("2.499")` bunu 2,499 TL olarak okuyup fiyatı
 * sessizce 1000'e bölüyordu. Kurallar:
 *   - Virgül varsa: noktalar binliktir, virgül ondalıktır.
 *   - Virgül yoksa ve noktalar tam binlik gruplaması yapıyorsa ("2.499",
 *     "1.234.567"): noktalar binliktir.
 *   - Aksi halde tek nokta ondalık kabul edilir ("1499.90", "12.5").
 * Geçersiz/boş girişte null döner — çağıran taraf kullanıcıya hata gösterir.
 */
export function parseTrNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.replace(/[\s₺]/g, "").replace(/TL$/i, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  let normalized: string;
  if (cleaned.includes(",")) {
    if (cleaned.indexOf(",") !== cleaned.lastIndexOf(",")) return null;
    const [integerPart, fractionPart] = cleaned.split(",");
    if (fractionPart.includes(".")) return null;
    // Tam kısımda nokta varsa geçerli bir binlik gruplaması olmalı ("1.2,5" değil).
    if (integerPart.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(integerPart)) return null;
    normalized = `${integerPart.replace(/\./g, "")}.${fractionPart}`;
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else {
    if (cleaned.indexOf(".") !== cleaned.lastIndexOf(".")) return null;
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Arama karşılaştırması için metni sadeleştirir: Türkçe harfleri ASCII
 * karşılığına indirir ve küçültür. Düz `toLowerCase()` "SIRT"ı "sirt" yapar
 * ama "Sırt" → "sırt" kalır; arama büyük harfle yazılınca hiçbir şey
 * bulunmuyordu. İki taraf da aynı fonksiyondan geçtiğinde "SIRT", "sirt" ve
 * "sırt" aynı ürünü bulur.
 */
export function foldForSearch(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}
