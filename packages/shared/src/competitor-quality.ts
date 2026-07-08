// ============================================
// Competitor data-quality policy (single source of truth)
// ============================================
//
// Bir rakip kaydının "karar verilebilir" (piyasa pozisyonu, önerilen fiyat,
// COMPETITOR_CHEAPER alarmı) sayılması için geçmesi gereken merkezi kurallar.
// Web UI, web API'leri ve worker aynı politikayı kullanır.
//
// NOT: apps/worker bu paketi Docker build context'i nedeniyle import edemiyor;
// apps/worker/src/utils/competitor-quality.ts bu dosyanın birebir aynası olmak
// zorunda. Burada değişiklik yaparsan worker kopyasını da güncelle.

// Minimum AI match confidence (0-100) for treating a candidate as the same
// product. Worker matcher ve web competitor filtreleme ile senkron.
export const MIN_MATCH_SCORE = 70;

// Fiyat bandı: kaynak fiyatın 0.3x–3x'i dışındaki adaylar aynı ürün değildir.
// Matcher prompt'undaki "%300 fiyat farkı" kuralıyla senkron tutulur.
export const PRICE_BAND_MIN_RATIO = 0.3;
export const PRICE_BAND_MAX_RATIO = 3.0;

// Bu saatten eski rakip fiyatı karar hesaplarına (pozisyon, öneri, alarm) girmez.
// UI'daki "Eski" rozeti ile aynı eşik.
export const COMPETITOR_STALE_HOURS = 72;

export function withinPriceBand(sourcePrice: number, candidatePrice: number): boolean {
  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0) return true;
  if (!Number.isFinite(candidatePrice) || candidatePrice <= 0) return false;
  return (
    candidatePrice >= sourcePrice * PRICE_BAND_MIN_RATIO &&
    candidatePrice <= sourcePrice * PRICE_BAND_MAX_RATIO
  );
}

// ============================================
// Ambalaj / koli / lojistik malzemesi tespiti
// ============================================
//
// Serper, ürün aramalarında "Bojopack 20x15x10 Koli", "kolikutugelsin" gibi
// ambalaj satıcısı sonuçları döndürebiliyor. AI matcher prompt'unda bu kural
// var ama deterministik bir emniyet kemeri gerekiyor: AI çökerse, yanılırsa
// veya hiç çalışmazsa (legacy kayıtlar) bile koli, terlikle eşleşmemeli.

// Kelime İÇİNDE geçmesi yeterli işaretler (kolikutugelsin, kolicim, ambalajci...).
const PACKAGING_SUBSTRINGS = [
  "koli",
  "ambalaj",
  "mukavva",
  "jelatin",
  "paketleme",
  "baloncuklu",
  "shrink",
  "şirink",
];

// PACKAGING_SUBSTRINGS'e takılan ama ambalaj olmayan gerçek ürün kelimeleri.
const PACKAGING_SUBSTRING_EXCLUSIONS = ["brokoli"];

// Tam ifade olarak aranan işaretler.
const PACKAGING_PHRASES = [
  "kargo kutusu",
  "kargo poşeti",
  "koli bandı",
  "streç film",
  "stretch film",
  "e-ticaret kutusu",
  "ambalaj kutusu",
  "desi kutu",
];

// "20x15x10 kutu" kalıbı: üç boyut + kutu kelimesi birlikte ambalaj demektir.
const BOX_DIMENSION_RE = /\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/;

function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

function hasPackagingSignal(title: string): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;

  for (const phrase of PACKAGING_PHRASES) {
    if (normalized.includes(phrase)) return true;
  }

  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const word of words) {
    if (PACKAGING_SUBSTRING_EXCLUSIONS.some((excluded) => word.includes(excluded))) continue;
    if (PACKAGING_SUBSTRINGS.some((token) => word.includes(token))) return true;
  }

  if (BOX_DIMENSION_RE.test(normalized) && /(^|[^\p{L}])kutu/u.test(normalized)) return true;

  return false;
}

/**
 * Aday başlığı ambalaj/koli/lojistik ürünü gibi görünüyor ve kaynak ürün öyle
 * değilse true döner. Kaynak ürünün kendisi ambalaj ürünüyse (satıcı koli
 * takip ediyorsa) false döner — o durumda eşleşme meşru olabilir.
 */
export function isPackagingListing(candidateTitle: string, sourceTitle?: string): boolean {
  if (!hasPackagingSignal(candidateTitle)) return false;
  if (sourceTitle && hasPackagingSignal(sourceTitle)) return false;
  return true;
}

// ============================================
// Rakip kullanılabilirlik değerlendirmesi
// ============================================

export type CompetitorIssue = "no-price" | "low-score" | "out-of-band" | "stale";

export interface CompetitorAssessmentInput {
  /** Parse edilmiş güncel fiyat; null/0 geçersiz sayılır. */
  price: number | null;
  /** AI eşleşme skoru; null = skorlanmamış (legacy/manuel kayıt). */
  matchScore: number | null;
  /** Son fiyat alınma zamanı; null = hiç alınmamış. */
  lastScrapedAt: Date | string | null;
}

export interface CompetitorAssessmentOptions {
  /** Kullanıcının kendi fiyatı — verilirse fiyat bandı kontrolü uygulanır. */
  ownPrice?: number | null;
  /** Değerlendirme anı (test edilebilirlik için); default şimdi. */
  now?: Date;
  /** Bayatlık eşiği saat cinsinden; default COMPETITOR_STALE_HOURS. */
  maxAgeHours?: number;
}

export interface CompetitorAssessment {
  usable: boolean;
  issues: CompetitorIssue[];
}

/**
 * Bir rakip kaydının karar hesaplarına girip giremeyeceğini değerlendirir.
 * usable=false olan rakipler listede gösterilmeye devam edebilir ama piyasa
 * pozisyonu, fiyat önerisi ve COMPETITOR_CHEAPER alarmı bunları kullanmaz.
 */
export function assessCompetitor(
  input: CompetitorAssessmentInput,
  options: CompetitorAssessmentOptions = {},
): CompetitorAssessment {
  const issues: CompetitorIssue[] = [];
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? COMPETITOR_STALE_HOURS;

  const price = input.price;
  const hasPrice = typeof price === "number" && Number.isFinite(price) && price > 0;
  if (!hasPrice) issues.push("no-price");

  if (input.matchScore !== null && input.matchScore !== undefined) {
    if (input.matchScore < MIN_MATCH_SCORE) issues.push("low-score");
  }

  const ownPrice = options.ownPrice;
  if (
    hasPrice &&
    typeof ownPrice === "number" &&
    Number.isFinite(ownPrice) &&
    ownPrice > 0 &&
    !withinPriceBand(ownPrice, price as number)
  ) {
    issues.push("out-of-band");
  }

  if (!input.lastScrapedAt) {
    issues.push("stale");
  } else {
    const scrapedAt = new Date(input.lastScrapedAt);
    const ageHours = (now.getTime() - scrapedAt.getTime()) / (1000 * 60 * 60);
    if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) issues.push("stale");
  }

  return { usable: issues.length === 0, issues };
}

export function isUsableCompetitor(
  input: CompetitorAssessmentInput,
  options: CompetitorAssessmentOptions = {},
): boolean {
  return assessCompetitor(input, options).usable;
}

// ============================================
// Ürün kodu (MPN / barkod) çıkarımı ve eşleştirme
// ============================================
//
// Aynı ürünü farklı satıcılarda bulmanın en güvenilir yolu MPN/barkod gibi
// benzersiz kodlardır (ör. Lenovo "83SC000QTR", barkod "8681677004991").
// Bunlar arama sorgusunda kullanılırsa birebir aynı ürün bulunur; iki başlık
// UZUN (>=10) bir kodu paylaşıyorsa kesinlikle aynı üründür — CPU/RAM gibi
// kısa spec kodları (i5-13450HX → 9 hane) bu eşiğin altında kalıp yanlış
// eşleşme yapmaz. Böylece "katı ol ama akıllı ol" sağlanır.

export function extractProductCodes(text: string): string[] {
  if (!text) return [];
  const found: Array<{ raw: string; norm: string }> = [];
  // Barkodlar: 8-14 haneli salt-rakam diziler.
  for (const m of text.matchAll(/\b\d{8,14}\b/g)) {
    found.push({ raw: m[0], norm: m[0] });
  }
  // MPN benzeri: harf+rakam karışık, normalize uzunluk >=6.
  for (const m of text.matchAll(/\b[A-Za-z0-9][A-Za-z0-9-]{4,}[A-Za-z0-9]\b/g)) {
    const norm = m[0].replace(/-/g, "").toUpperCase();
    if (norm.length < 6) continue;
    if (!/[A-Z]/.test(norm) || !/\d/.test(norm)) continue; // harf VE rakam içermeli
    found.push({ raw: m[0], norm });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  // En uzun kod en spesifik (MPN/barkod) — önce o.
  for (const c of found.sort((a, b) => b.norm.length - a.norm.length)) {
    if (seen.has(c.norm)) continue;
    seen.add(c.norm);
    out.push(c.raw);
  }
  return out;
}

const STRONG_CODE_MIN_LEN = 10;

function strongCodeSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of extractProductCodes(text)) {
    const norm = raw.replace(/-/g, "").toUpperCase();
    if (norm.length >= STRONG_CODE_MIN_LEN) set.add(norm);
  }
  return set;
}

/**
 * İki başlık, çakışması neredeyse imkânsız uzun bir kod (MPN/barkod, >=10)
 * paylaşıyor mu? Paylaşıyorsa kesinlikle aynı üründür.
 */
export function sharesStrongProductCode(a: string, b: string): boolean {
  const setA = strongCodeSet(a);
  if (setA.size === 0) return false;
  const setB = strongCodeSet(b);
  for (const code of setB) if (setA.has(code)) return true;
  return false;
}

// ============================================
// Spec çakışması tespiti (varyant guard'ı)
// ============================================
//
// Aynı temel MPN'i paylaşan KONFİGÜRASYON varyantları (Lenovo 83SC000QTR:
// 16GB/512GB vs 83SC000QTR-001: 20GB/512GB vs 83SC000QTR-006: 16GB/1TB) farklı
// SKU'lardır; "kod eşleşti → kesin aynı ürün" kabulü bunları %95 ile rakip
// yapıp piyasa istatistiklerini bozuyordu. Sayı+birim imzaları iki başlıkta da
// bulunan birim ekseninde ÇELİŞİYORSA deterministik kabul yapılmaz.
//
// Yalnızca güvenli eksenler karşılaştırılır (GB/TB, ml/L, g/kg, W): bir başlıkta
// yazıp diğerinde hiç geçmeyen özellik "eksik bilgi"dir, çelişki DEĞİLDİR.

const SPEC_TOKEN_RE = /(\d+(?:[.,]\d+)?)\s*(tb|gb|ml|lt|l|kg|gr|g|w|watt)\b/gi;

/** Birim eksenleri: TB→GB, L/LT→ml, kg→g, watt→W tek eksende toplanır. */
function specAxes(text: string): Map<string, Set<number>> {
  const axes = new Map<string, Set<number>>();
  if (!text) return axes;
  for (const m of text.matchAll(SPEC_TOKEN_RE)) {
    const value = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = m[2].toLowerCase();
    let axis: string;
    let normalized: number;
    switch (unit) {
      case "tb":
        axis = "gb";
        normalized = value * 1024;
        break;
      case "gb":
        axis = "gb";
        normalized = value;
        break;
      case "l":
      case "lt":
        axis = "ml";
        normalized = value * 1000;
        break;
      case "ml":
        axis = "ml";
        normalized = value;
        break;
      case "kg":
        axis = "g";
        normalized = value * 1000;
        break;
      case "g":
      case "gr":
        axis = "g";
        normalized = value;
        break;
      default:
        axis = "w";
        normalized = value;
        break;
    }
    const set = axes.get(axis) ?? new Set<number>();
    set.add(normalized);
    axes.set(axis, set);
  }
  return axes;
}

function sameNumberSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * İki başlığın HER İKİSİNDE de geçen bir spec ekseni (GB, ml, g, W) farklı
 * değer kümeleri taşıyorsa true: bunlar aynı modelin FARKLI varyantlarıdır
 * (16GB≠20GB RAM, 512GB≠1TB SSD, 50ml≠100ml). Eksik bilgi çelişki sayılmaz.
 */
export function hasConflictingSpecs(a: string, b: string): boolean {
  const axesA = specAxes(a);
  if (axesA.size === 0) return false;
  const axesB = specAxes(b);
  for (const [axis, valuesA] of axesA) {
    const valuesB = axesB.get(axis);
    if (!valuesB) continue; // eksende tek taraflı bilgi → fark değil
    if (!sameNumberSet(valuesA, valuesB)) return true;
  }
  return false;
}
