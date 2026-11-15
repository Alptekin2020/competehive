// ============================================
// Deterministik başlık benzerliği (matcher'ın AI'dan bağımsız katmanı)
// ============================================
//
// Prod logları (14–15 Kasım 2026) AI'ın birebir aynı ürünleri reddettiğini
// gösterdi: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr" kaynağına
// aynı başlıklı aday 30 puan aldı; "icollagen Kolajen Ve Prebiyotik Tablet"
// adayı 60'ta kaldı ve ürün 0 rakiple bitti. Model kodu olmayan ürünlerde
// (gıda, takviye, kozmetik) kod tabanlı deterministik kabul devreye girmediği
// için karar tamamen AI'ın inisiyatifine kalıyordu.
//
// Bu modül iki başlığın kelime kümelerini karşılaştırır ve iki karar verir:
// - `isNearIdenticalTitle`: başlıklar pratikte aynı → AI'a sormadan kabul.
// - `isStrongTitleOverlap`: AI kararsız kaldığında (50–69) kabulü destekleyen
//   daha gevşek eşik.
// İkisi de yalnızca hiçbir çelişki sinyali yokken true döner; şüphede karar
// AI'a ve kullanıcı onayına kalır (yanlış rakip, kaçan rakipten pahalıdır).

import {
  compareProductCodes,
  extractProductCodes,
  hasConflictingCountDescriptors,
  hasConflictingSpecs,
  isAccessoryListing,
  isPackagingListing,
} from "./competitor-quality";

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

// Ürün kimliği taşımayan sözcükler: bağlaçlar, pazarlama ekleri, pazaryeri
// adları ve "60'lı" gibi yazımlardan kopan ek parçaları.
const NOISE_TOKENS = new Set([
  "ve",
  "ile",
  "icin",
  "adet",
  "orijinal",
  "orjinal",
  "yeni",
  "kaliteli",
  "lux",
  "luks",
  "hediyeli",
  "fiyat",
  "fiyati",
  "fiyatlari",
  "ozellikleri",
  "yorumlari",
  "bandrollu",
  "ucretsiz",
  "kargo",
  "faturali",
  "garanti",
  "garantili",
  "yil",
  "resmi",
  "distributor",
  "turkiye",
  "trendyol",
  "hepsiburada",
  "n11",
  "amazon",
  "pttavm",
  "com",
  "tr",
  "li",
  "lu",
  "lik",
  "luk",
]);

const UNIT_ALIASES: Record<string, string> = { g: "gr", gram: "gr", l: "lt", litre: "lt" };

// Tek başına ürünü DEĞİŞTİREN sözcükler: model kademesi (Pro/Max/Kids) ve
// paket/kondisyon bilgisi (set, avantaj paketi, yenilenmiş). Hangi başlıkta
// fazladan geçerse geçsin deterministik kabulü engeller.
const VARIANT_TOKENS = new Set([
  "pro",
  "max",
  "plus",
  "mini",
  "ultra",
  "lite",
  "kids",
  "junior",
  "cocuk",
  "bebek",
  "se",
  "fe",
  "air",
  "xl",
  "xxl",
  "xs",
  "set",
  "seti",
  "paket",
  "paketi",
  "avantaj",
  "ekonomik",
  "ekonomi",
  "ikili",
  "uclu",
  "coklu",
  "refill",
  "yedek",
  "yenilenmis",
  "outlet",
  "teshir",
]);

// Ürün FORMU sözcükleri: adayda fazladan geçiyorsa farklı formdur (kaynak
// tablet, aday "gummy"/"toz"). Kaynakta yazıp adayda yazmaması eksik bilgidir.
const FORM_TOKENS = new Set([
  "gummy",
  "gummies",
  "jelibon",
  "toz",
  "sprey",
  "kapsul",
  "tablet",
  "sase",
  "damla",
  "surup",
  "krem",
  "jel",
  "losyon",
  "sampuan",
  "sivi",
  "stick",
]);

export function titleTokens(title: string): string[] {
  const text = fold(title)
    // "100gr", "60adet" → sayı ile birimi ayır; model kodlarına (ep3347) dokunma.
    .replace(/(\d)(gr|g|ml|lt|l|kg|mg|adet|tablet|kapsul)\b/g, "$1 $2");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const token = UNIT_ALIASES[raw] ?? raw;
    if (NOISE_TOKENS.has(token)) continue;
    if (token.length < 2 && !/\d/.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export interface TitleSimilarity {
  /** Kaynağın ilk anlamlı sözcüğü (marka) adayda da geçiyor mu? */
  brandShared: boolean;
  /** Ortak sözcük sayısı. */
  shared: number;
  /** Kaynak sözcüklerinin adayda bulunan oranı (0–1). */
  sourceCoverage: number;
  /** Aday sözcüklerinin kaynakta bulunan oranı (0–1). */
  candidateCoverage: number;
  /** Yalnızca bir başlıkta geçen sözcükler arasında varyant sözcüğü var mı? */
  hasVariantExtra: boolean;
  /** Yalnızca bir başlıkta geçen sözcükler arasında rakam içeren var mı? */
  hasNumericExtra: boolean;
}

export function compareTitles(sourceTitle: string, candidateTitle: string): TitleSimilarity {
  const src = titleTokens(sourceTitle);
  const cnd = titleTokens(candidateTitle);
  const srcSet = new Set(src);
  const cndSet = new Set(cnd);
  const shared = src.filter((t) => cndSet.has(t)).length;
  const sourceExtras = src.filter((t) => !cndSet.has(t));
  const candidateExtras = cnd.filter((t) => !srcSet.has(t));
  const extras = [...sourceExtras, ...candidateExtras];
  return {
    brandShared: src.length > 0 && cndSet.has(src[0]),
    shared,
    sourceCoverage: src.length === 0 ? 0 : shared / src.length,
    candidateCoverage: cnd.length === 0 ? 0 : shared / cnd.length,
    hasVariantExtra:
      extras.some((t) => VARIANT_TOKENS.has(t)) || candidateExtras.some((t) => FORM_TOKENS.has(t)),
    hasNumericExtra: extras.some((t) => /\d/.test(t)),
  };
}

// Paket içi adet / çoklu paket: "60 adet", "60'lı", "60 Tablet", "2 Adet".
const QUANTITY_RE = /(\d+)\s*['’]?\s*(?:adet|li|lu|tablet|kapsul|sase|servis)\b/g;
// "X 6 Adet", "6 x 100 gr", "6x100": çarpanlı çoklu paket yazımı.
const MULTIPLIER_RES = [/\bx\s*(\d+)\b/g, /\b(\d+)\s*x\s*\d/g];

function quantities(title: string): Set<number> {
  const set = new Set<number>();
  const folded = fold(title);
  for (const m of folded.matchAll(QUANTITY_RE)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  for (const re of MULTIPLIER_RES) {
    for (const m of folded.matchAll(re)) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
  }
  return set;
}

/**
 * İki başlık da adet bilgisi veriyor ve kümeler farklıysa true: "60 Tablet"
 * ≠ "60 Tablet 2 Adet", "30 Kapsül" ≠ "60 Kapsül". Tek taraflı bilgi çelişki
 * değildir (matcher Kural 14 ile aynı politika).
 */
export function hasConflictingQuantities(a: string, b: string): boolean {
  const qa = quantities(a);
  const qb = quantities(b);
  if (qa.size === 0 || qb.size === 0) return false;
  if (qa.size !== qb.size) return true;
  for (const v of qa) if (!qb.has(v)) return true;
  return false;
}

/**
 * Aday çoklu paket gibi görünüyor ama kaynak hiç adet yazmıyor: "100 gr" ↔
 * "100 Gr X 6 Adet", "100 G (7'li Paket)". Prod (15 Kasım): arama sonucundaki
 * kısaltılmış başlık paket bilgisini gizledi, 6'lı paket 88 puanla tekli ürünün
 * rakibi oldu. Tek taraflı bilgi normalde çelişki değildir; ama fazladan adet
 * bilgisi fiyatı katlayan bir farktır, bu yüzden deterministik kabulü engeller.
 */
export function hasMultipackSignal(sourceText: string, candidateText: string): boolean {
  if (quantities(sourceText).size > 0) return false;
  for (const n of quantities(candidateText)) if (n >= 2) return true;
  return false;
}

/** URL yolunu sözcüklere çevirir: "/urun-100-g-7-li-paket-p-123" → "urun 100 g 7 li paket p 123". */
export function urlSlugText(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname)
      .replace(/[-_/+.]+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * Paket adedi ya da ölçü (ml, gr, GB, fincan…) çelişkisi. Model kodu
 * karşılaştırması içermez: URL yolundaki ilan numaraları kod sanılmasın diye
 * URL metni ve taranan sayfa başlığı bu dar denetimden geçer.
 */
export function hasPackOrSpecConflict(sourceText: string, candidateText: string): boolean {
  return (
    hasConflictingSpecs(sourceText, candidateText) ||
    hasConflictingCountDescriptors(sourceText, candidateText) ||
    hasConflictingQuantities(sourceText, candidateText) ||
    hasMultipackSignal(sourceText, candidateText)
  );
}

/**
 * İki başlık da model kodu taşıyor ama ortak (ya da renk varyantı) kod yok:
 * EP3347 ↔ EP3343 farklı modeldir, başlığın geri kalanı ne kadar benzerse
 * benzesin.
 */
export function hasDifferentProductCodes(a: string, b: string): boolean {
  if (extractProductCodes(a).length === 0 || extractProductCodes(b).length === 0) return false;
  return compareProductCodes(a, b) === "none";
}

/** Deterministik olarak doğrulanabilen herhangi bir çelişki sinyali var mı? */
export function hasTitleConflict(sourceTitle: string, candidateTitle: string): boolean {
  return (
    isPackagingListing(candidateTitle, sourceTitle) ||
    isAccessoryListing(candidateTitle, sourceTitle) ||
    hasConflictingSpecs(sourceTitle, candidateTitle) ||
    hasConflictingCountDescriptors(sourceTitle, candidateTitle) ||
    hasConflictingQuantities(sourceTitle, candidateTitle) ||
    hasMultipackSignal(sourceTitle, candidateTitle) ||
    hasDifferentProductCodes(sourceTitle, candidateTitle) ||
    compareProductCodes(sourceTitle, candidateTitle) === "config-variant"
  );
}

const MIN_SHARED_TOKENS = 3;

/**
 * Başlıklar pratikte aynı mı? Marka ortak, kaynak sözcüklerinin en az %80'i
 * adayda, aday sözcüklerinin en az %70'i kaynakta; fazladan sözcükler arasında
 * rakam ya da varyant sözcüğü yok ve hiçbir çelişki sinyali yok.
 */
export function isNearIdenticalTitle(sourceTitle: string, candidateTitle: string): boolean {
  const sim = compareTitles(sourceTitle, candidateTitle);
  return (
    sim.brandShared &&
    sim.shared >= MIN_SHARED_TOKENS &&
    sim.sourceCoverage >= 0.8 &&
    sim.candidateCoverage >= 0.7 &&
    !sim.hasVariantExtra &&
    !sim.hasNumericExtra &&
    !hasTitleConflict(sourceTitle, candidateTitle)
  );
}

/**
 * AI'ın "benzer ama emin değilim" (50–69) dediği adayı kabule taşıyacak kadar
 * güçlü örtüşme var mı? Rakamlı fazlalıklara ("5 Tip", eksik "60") izin verir
 * çünkü adet/spec/kod çelişkileri ayrıca denetlenir; varyant sözcükleri yine
 * engeldir. İkinci koşul uzun SEO başlıklı kaynağın kısaltılmış adayını kapsar.
 */
export function isStrongTitleOverlap(sourceTitle: string, candidateTitle: string): boolean {
  const sim = compareTitles(sourceTitle, candidateTitle);
  if (!sim.brandShared || sim.hasVariantExtra) return false;
  const mostlySame =
    sim.shared >= MIN_SHARED_TOKENS && sim.sourceCoverage >= 0.8 && sim.candidateCoverage >= 0.6;
  const abbreviation =
    sim.shared >= MIN_SHARED_TOKENS + 1 &&
    sim.candidateCoverage >= 0.9 &&
    sim.sourceCoverage >= 0.5;
  return (mostlySame || abbreviation) && !hasTitleConflict(sourceTitle, candidateTitle);
}
