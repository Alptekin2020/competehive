// ============================================
// Competitor data-quality policy — WORKER MIRROR
// ============================================
//
// BU DOSYA packages/shared/src/competitor-quality.ts DOSYASININ BİREBİR
// AYNASIDIR. Worker'ın Docker build context'i apps/worker/ ile sınırlı olduğu
// için @competehive/shared buradan import edilemiyor (normalize-product-image
// ile aynı kalıp). Politika değişikliklerinde iki dosyayı birlikte güncelle.

// Minimum AI match confidence (0-100) for treating a candidate as the same
// product. packages/shared/src/competitor-quality.ts ile senkron.
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
