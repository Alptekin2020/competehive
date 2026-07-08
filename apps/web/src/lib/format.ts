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
