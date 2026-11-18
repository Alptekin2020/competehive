// ============================================
// İlan kimliği: barkod (GTIN) ve Trendyol mağaza yolundaki marka
// ============================================
//
// İki deterministik sinyal, AI'dan önce okunur:
//
// 1) Barkod (GTIN/EAN): ürünün başlığında ya da metadata'sında geçerli bir
//    barkod varsa ve aday ilanın başlığı/adresi/arama özeti ya da sayfası aynı
//    barkodu taşıyorsa ilan aynı üründür. Model kodu olmayan kozmetik/takviye
//    ürünlerinde tek güvenilir kimlik budur (prod 18 Kasım: Evde Aesthetic
//    serumunun N11'deki aynı ilanı kesik başlık yüzünden 40 puanla reddedildi,
//    ürün hiç rakipsiz kaldı).
//
// 2) Trendyol marka yolu: Trendyol başlıkları markayı yazmaz; marka ilan
//    adresinin ilk yol parçasındadır (`trendyol.com/doganay/mutfak-…`). AI bu
//    yüzden aynı markanın ilanını "farklı marka" diye reddediyordu (prod 18
//    Kasım: Doğanay bataryası). Yol parçası kaynağın markasıyla aynıysa marka
//    aday başlığının önüne eklenir.

function fold(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** EAN-8 / UPC-A (12) / EAN-13 / GTIN-14 kontrol hanesi doğru mu? */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // Sağdan sola: kontrol hanesinin hemen solundaki hane x3.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Başlıktaki barkod: 12–14 haneli, kontrol hanesi geçerli bağımsız sayı.
 * 8 haneli sayılar başlıkta çoğu zaman ilan/model numarasıdır; alınmaz.
 */
export function extractTitleGtin(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const m of title.matchAll(/(?<!\d)(\d{12,14})(?!\d)/g)) {
    if (isValidGtin(m[1])) return m[1];
  }
  return null;
}

/** Metin aynı barkodu bağımsız bir sayı olarak içeriyor mu? */
export function textHasGtin(text: string | null | undefined, gtin: string | null): boolean {
  if (!text || !gtin) return false;
  return new RegExp(`(?<!\\d)${gtin}(?!\\d)`).test(text);
}

/** Trendyol ilan adresinin mağaza/marka yol parçası (`/pd/<marka>/…` dahil). */
export function trendyolBrandSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)trendyol\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const segment = parts[0] === "pd" ? parts[1] : parts[0];
    // Tek parçalı yol (/sr, /butik…) ya da ürün yolu değilse marka yoktur.
    if (!segment || parts.length < (parts[0] === "pd" ? 3 : 2)) return null;
    return segment.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Kaynağın markası (başlığın ilk 1–3 sözcüğü) Trendyol ilanının marka yolu ile
 * aynıysa ve aday başlığında yoksa, markayı başlığın önüne ekler.
 */
export function withListingBrand(
  sourceTitle: string,
  candidateTitle: string,
  url?: string,
): string {
  const slug = trendyolBrandSlug(url);
  if (!slug) return candidateTitle;
  const words = sourceTitle.trim().split(/\s+/);
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const brand = words.slice(0, n).join(" ");
    if (slugify(brand) !== slug) continue;
    if (/\d/.test(brand) || brand.length < 2) return candidateTitle;
    const candidateSlug = `-${slugify(candidateTitle)}-`;
    if (candidateSlug.includes(`-${slug}-`)) return candidateTitle;
    return `${brand} ${candidateTitle}`;
  }
  return candidateTitle;
}
