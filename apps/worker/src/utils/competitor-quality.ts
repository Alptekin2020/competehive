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

export type CompetitorIssue = "no-price" | "low-score" | "out-of-band" | "stale" | "peer-outlier";

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
// Akran-medyan fiyat aykırılığı (peer outlier)
// ============================================
//
// Prod vakası (Philips HD9650/90): 16 rakibin 14'ü ₺7.2K–16.4K bandındayken
// tek bir ilan ₺3.000 gösteriyordu — neredeyse kesin sahte/yem ilan. Kendi
// fiyata göre kurulan 0.3x–3x bandını (3000/9475 = 0.317) kılpayı geçtiği
// için "geçerli" sayıldı ve "önerilen fiyat ₺2.999" gibi ZARARLI bir tavsiye
// üretti. Kendi fiyat yanlış çapa: kullanıcının fiyatı piyasanın kenarında
// olabilir. Doğru çapa AKRAN GRUBUNUN MEDYANIDIR — sağlam (robust) istatistik,
// tek aykırı değerden etkilenmez.
//
// Kural bilinçli olarak İKİ koşul ister (yalnız oran değil):
//   1) Fiyat, akran medyanından aşırı kopuk (düşükte <0.45x, yüksekte >2.75x)
//   2) En yakın akrandan da İZOLE (düşükte ≥1.8x, yüksekte ≥1.5x boşluk)
// İzolasyon şartı gerçek fiyat savaşlarını korur: iki satıcı birlikte ucuzsa
// (küme) bu gerçek olabilir; tek başına dipte duran ilan ise şüphelidir.
// En az PEER_OUTLIER_MIN_PEERS akran yoksa kural HİÇ çalışmaz (küçük örneklemde
// medyan güvenilmez). Tek geçişlidir — aykırılar çıkarılıp yeniden hesaplanmaz
// (kademeli daralma/yakınsama sorularından kaçınmak için bilinçli tercih).

export const PEER_OUTLIER_MIN_PEERS = 4;
export const PEER_OUTLIER_LOW_RATIO = 0.45;
export const PEER_OUTLIER_LOW_GAP = 1.8;
export const PEER_OUTLIER_HIGH_RATIO = 2.75;
export const PEER_OUTLIER_HIGH_GAP = 1.5;

export type PeerOutlierKind = "too-low" | "too-high";

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fiyatın, akran fiyatlarına (kendisi HARİÇ) göre aykırı olup olmadığını
 * söyler. Aykırı değilse null döner.
 */
export function detectPeerPriceOutlier(
  price: number,
  peerPrices: number[],
): PeerOutlierKind | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const peers = peerPrices
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice()
    .sort((a, b) => a - b);
  if (peers.length < PEER_OUTLIER_MIN_PEERS) return null;

  const median = medianOf(peers);
  if (!Number.isFinite(median) || median <= 0) return null;

  const nearest = peers.reduce(
    (best, p) => (Math.abs(p - price) < Math.abs(best - price) ? p : best),
    peers[0],
  );

  if (price < median * PEER_OUTLIER_LOW_RATIO && nearest / price >= PEER_OUTLIER_LOW_GAP) {
    return "too-low";
  }
  if (price > median * PEER_OUTLIER_HIGH_RATIO && price / nearest >= PEER_OUTLIER_HIGH_GAP) {
    return "too-high";
  }
  return null;
}

/**
 * Rakip listesini İKİ geçişte değerlendirir ve girişle aynı sırada
 * CompetitorAssessment dizisi döner:
 *   Geçiş 1 — tekil kontroller (fiyat, skor, band, bayatlık).
 *   Geçiş 2 — geçiş 1'i geçenler arasında akran-medyan aykırılığı; aykırı
 *             bulunanlara "peer-outlier" issue eklenir ve usable=false olur.
 * Pozisyon, öneri, alarm gibi TÜM karar noktaları tekil assessCompetitor
 * yerine bunu kullanmalıdır — akran bağlamı ancak listeyle kurulabilir.
 */
export function assessCompetitorList(
  inputs: CompetitorAssessmentInput[],
  options: CompetitorAssessmentOptions = {},
): CompetitorAssessment[] {
  const base = inputs.map((input) => assessCompetitor(input, options));

  const provisionalPrices: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const price = inputs[i].price;
    if (base[i].usable && typeof price === "number" && Number.isFinite(price) && price > 0) {
      provisionalPrices.push(price);
    }
  }
  // Kendisi + en az MIN_PEERS akran gerekir; yoksa aykırılık aranmaz.
  if (provisionalPrices.length < PEER_OUTLIER_MIN_PEERS + 1) return base;

  return base.map((assessment, i) => {
    if (!assessment.usable) return assessment;
    const price = inputs[i].price as number;
    // Akranlar = kendisi hariç geçerli fiyatlar. Aynı fiyatlı BAŞKA satıcılar
    // akran olarak kalmalı — bu yüzden değerden yalnızca BİR kopya çıkarılır.
    const selfIdx = provisionalPrices.indexOf(price);
    const peers = provisionalPrices.filter((_, j) => j !== selfIdx);
    const outlier = detectPeerPriceOutlier(price, peers);
    if (!outlier) return assessment;
    return { usable: false, issues: [...assessment.issues, "peer-outlier" as const] };
  });
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

// FARKLI modellerin başlıklarında da geçen ORTAK donanım/spec kodları. Bunlar
// ürün KİMLİĞİ değildir: iki farklı laptop da "i5-13450HX", "RTX5050", "144Hz",
// "GDDR7" içerir. Kod tabanlı kimlik eşleştirmesinde kullanılamazlar; eleme
// yalnızca deterministik kabul kapsamını daraltır, asla yanlış kabul üretmez.
// Desenler NORMALİZE koda (tiresiz, BÜYÜK harf) uygulanır.
const SHARED_HARDWARE_CODE_RES = [
  /^I[3579]\d{3,5}[A-Z]{0,3}$/, // Intel Core: I513450HX, I71255U
  /^(RTX|GTX|GT|MX|RX|ARC)\d{3,4}[A-Z]{0,3}$/, // GPU aileleri
  /^R[3579]\d{3,4}[A-Z]{0,3}$/, // AMD Ryzen kısaltmaları (R55600H)
  /^\d{3,5}(U|H|HS|HX|K|KF|KS|F|G|GE|T|X3D|XT|TI|SUPER)$/, // CPU/GPU eki: 5500U, 13450HX, 4060TI
  /^(LP)?DDR\d[A-Z]?$/, // bellek standardı
  /^GDDR\d[A-Z]?$/,
  /^WIFI\d[A-Z]?$/,
  /^USB\d+$/,
  /^HDMI\d+$/,
  /^(BT|NFC|IP)\d{1,2}[A-Z]?$/, // BT50, IP67
  // Sayı+birim imzaları (144HZ, 5000MAH, 220V, 1080P): spec'tir, kimlik değildir.
  /^\d+(HZ|FPS|RPM|MAH|MHZ|GHZ|NITS?|DPI|PPI|INC|INCH|CM|MM|GB|TB|MB|ML|LT|KG|GR|W|WATT|V|A|AH|BAR|PSI|TL|P|K)$/,
  /^\d+X\d+(X\d+)?$/, // boyut kalıbı 20X15X10
];

function isSharedHardwareCode(norm: string): boolean {
  return SHARED_HARDWARE_CODE_RES.some((re) => re.test(norm));
}

export function extractProductCodes(text: string): string[] {
  if (!text) return [];
  const found: Array<{ raw: string; norm: string }> = [];
  // Barkodlar: 8-14 haneli salt-rakam diziler.
  for (const m of text.matchAll(/\b\d{8,14}\b/g)) {
    found.push({ raw: m[0], norm: m[0] });
  }
  // MPN benzeri: harf+rakam karışık, normalize uzunluk >=5. Küçük ev aleti
  // kodları 5 karakter olabilir (Arzum "OK004") — eski >=6 eşiği bu ürünlerde
  // deterministik eşleşmeyi tamamen devre dışı bırakıp kararı AI'ın inisiyatifine
  // bırakıyordu (prod: birebir aynı OK004 makineleri "kapasite belirtilmemiş"
  // bahanesiyle 81 kez reddedildi). Salt donanım/spec kodları kimlik sayılmaz.
  for (const m of text.matchAll(/\b[A-Za-z0-9][A-Za-z0-9-]{3,}[A-Za-z0-9]\b/g)) {
    const norm = m[0].replace(/-/g, "").toUpperCase();
    if (norm.length < 5) continue;
    if (!/[A-Z]/.test(norm) || !/\d/.test(norm)) continue; // harf VE rakam içermeli
    if (isSharedHardwareCode(norm)) continue;
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

// ============================================
// Birimsiz ADET tanımlayıcıları ("4 Fincan", "6 Kişilik", "3 Katlı")
// ============================================
//
// SPEC_TOKEN_RE yalnız birimli değerleri (GB/ml/g/W) görür; "4 fincan" gibi
// birimsiz kapasite sözcükleri onun radarına girmez. Bu tanımlayıcılar da spec
// eksenleriyle aynı kurala tabidir: İKİ başlıkta da geçen sözcük farklı sayılar
// taşıyorsa varyanttır; tek taraflı bilgi ("4 Fincan" vs hiç yazmamış) fark
// DEĞİLDİR (matcher prompt'u Kural 14 ile aynı politika).

const COUNT_DESCRIPTOR_RE =
  /(\d+)\s*(fincan|kisilik|katli|parcali|parca|dilim|goz|cekmece|raf|hazneli|hazne|tepsili|tepsi)\b/g;

// Ek türevlerini tek eksene indir: "6 parça" ile "6 parçalı" aynı bilgidir.
const COUNT_AXIS_ALIASES: Record<string, string> = {
  parcali: "parca",
  hazneli: "hazne",
  tepsili: "tepsi",
};

function foldForCounts(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

function countAxes(text: string): Map<string, Set<number>> {
  const axes = new Map<string, Set<number>>();
  if (!text) return axes;
  for (const m of foldForCounts(text).matchAll(COUNT_DESCRIPTOR_RE)) {
    const value = parseInt(m[1], 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    const axis = COUNT_AXIS_ALIASES[m[2]] ?? m[2];
    const set = axes.get(axis) ?? new Set<number>();
    set.add(value);
    axes.set(axis, set);
  }
  return axes;
}

/**
 * İki başlığın HER İKİSİNDE de geçen bir adet tanımlayıcısı (fincan, kişilik,
 * katlı, parça...) farklı sayılar taşıyorsa true: "4 Fincan" ≠ "6 Fincan".
 * Tek taraflı bilgi çelişki sayılmaz.
 */
export function hasConflictingCountDescriptors(a: string, b: string): boolean {
  const axesA = countAxes(a);
  if (axesA.size === 0) return false;
  const axesB = countAxes(b);
  for (const [axis, valuesA] of axesA) {
    const valuesB = axesB.get(axis);
    if (!valuesB) continue;
    if (!sameNumberSet(valuesA, valuesB)) return true;
  }
  return false;
}

// ============================================
// Kod ilişkisi sınıflandırması (exact / renk varyantı / konfigürasyon varyantı)
// ============================================
//
// İki gerçek prod vakası bunu gerektirdi:
// 1. Arzum OK004 (5 karakter): kod deterministik olarak hiç çıkarılmıyordu,
//    karar AI'a kalıyordu ve AI birebir aynı makineleri "kapasite belirtilmemiş"
//    diyerek reddediyordu → kullanıcı "0 rakip" gördü.
// 2. Lenovo 83SC000QTR vs "83SC000QTR 015" / "83SC000QTR-001": alt-SKU eki
//    (zero-padded 001/006/015) spec imzasına yansımayınca (örn. FreeDOS vs
//    Windows 11 Pro) varyant, %95 "aynı ürün kodu" kabulünden geçiyordu.
//
// Politika: kod EKİ rakam içeriyorsa (015, 001) konfigürasyon varyantıdır →
// asla otomatik kabul edilmez. Ek 1-2 HARF ise renk varyantıdır (OK004-K,
// OK004-B) → fiyat takibi amacıyla AYNI ÜRÜNDÜR (matcher prompt Kural 15).

export type ProductCodeRelation = "exact" | "color-variant" | "config-variant" | "none";

// Kodun hemen ardından gelen ayrık, SIFIR ÖNCÜLÜ kısa rakam grubu alt-SKU
// ekidir: "83SC000QTR 015", "83sc000qtr-001". Sıfır öncülü şartı "83SC000QTR
// 15.6 inç" gibi ekran boyutlarının yanlışlıkla ek sayılmasını önler.
function configSuffixesFor(rawText: string, rawCode: string): Set<string> {
  const out = new Set<string>();
  if (!rawText || !rawCode) return out;
  const escaped = rawCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}[\\s\\-–—/]+(0\\d{1,3})(?![\\d.,])`, "gi");
  for (const m of rawText.matchAll(re)) out.add(m[1]);
  return out;
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function identityCodeMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of extractProductCodes(text)) {
    const norm = raw.replace(/-/g, "").toUpperCase();
    if (!map.has(norm)) map.set(norm, raw);
  }
  return map;
}

/**
 * İki başlığın paylaştığı ürün kodlarının ilişkisini sınıflandırır.
 *
 * - "config-variant": aynı temel kod ama rakamlı ek farkı (83SC000QTR vs
 *   83SC000QTR-015 veya "…QTR 001") → FARKLI SKU; asla otomatik kabul edilmez.
 *   Güvenlik önceliklidir: başka bir kod birebir eşleşse bile varyant sinyali
 *   kazanır (yanlış %95, kaçan bir rakipten daha pahalıdır).
 * - "exact": en az bir kod birebir aynı ve alt-SKU eki farkı yok.
 * - "color-variant": kodlardan biri diğerinin 1-2 HARFLİK ekli hali (OK004 vs
 *   OK004-K) → renk varyantı, fiyat takibi için aynı ürün.
 * - "none": paylaşılan kod yok.
 */
export function compareProductCodes(aText: string, bText: string): ProductCodeRelation {
  const aCodes = identityCodeMap(aText);
  if (aCodes.size === 0) return "none";
  const bCodes = identityCodeMap(bText);
  if (bCodes.size === 0) return "none";

  let exact = false;
  let colorVariant = false;

  // 1) Birebir aynı kod + bitişik alt-SKU eki karşılaştırması.
  for (const [norm, rawA] of aCodes) {
    const rawB = bCodes.get(norm);
    if (!rawB) continue;
    if (!sameStringSet(configSuffixesFor(aText, rawA), configSuffixesFor(bText, rawB))) {
      return "config-variant";
    }
    exact = true;
  }

  // 2) Önek-uzantı analizi (tire-bitişik yazım): OK004→OK004K renk eki;
  //    83SC000QTR→83SC000QTR015 rakamlı konfigürasyon eki.
  for (const [na] of aCodes) {
    for (const [nb] of bCodes) {
      if (na === nb) continue;
      const [shortN, longN] = na.length <= nb.length ? [na, nb] : [nb, na];
      if (!longN.startsWith(shortN)) continue;
      const ext = longN.slice(shortN.length);
      if (/\d/.test(ext)) return "config-variant";
      if (ext.length <= 2) colorVariant = true;
    }
  }

  if (exact) return "exact";
  if (colorVariant) return "color-variant";
  return "none";
}

// ============================================
// Aksesuar / yedek parça tespiti
// ============================================
//
// "ARZUM OK004 OKKA MİNİO ... MAKİNESİ İÇİN ORİJİNAL CEZVE GRUBU" gibi ilanlar
// makinenin KENDİSİ değil, ona ait parçadır — ama ana ürünün model kodunu ve
// başlık kelimelerinin çoğunu içerdiği için kod tabanlı deterministik kabulden
// geçebiliyordu (prod: Arzum OK004'e 4 cezve grubu %90 ile rakip yazıldı ve
// ₺1.450'lik cezve "en düşük rakip" olarak fiyat önerisini çarpıttı).
//
// Sinyaller:
// 1) Ayrık "için" sözcüğü: ilanın BAŞKA bir ürüne ait olduğunun güçlü işareti
//    ("X için kılıf/cezve/filtre").
// 2) Aksesuar/yedek parça sözcükleri.
//
// Paketleme guard'ı gibi TEK TARAFLI uygulanır: kaynak ürünün kendisi aksesuar
// ise (kullanıcı cezve satıyorsa) sinyal geçersizdir. Bu bir otomatik RED
// değildir — deterministik kabulü ATLAyıp kararı AI'a bırakma sinyalidir
// (matcher Kural 2/11 aksesuarı reddeder).

const ACCESSORY_TOKENS = new Set([
  "cezve",
  "cezvesi",
  "kilif",
  "kilifi",
  "kapak",
  "kapagi",
  "filtre",
  "filtresi",
  "hazne",
  "haznesi",
  "yedek",
  "aksesuar",
  "aksesuari",
  "aksesuarlari",
  "adaptor",
  "adaptoru",
  "kablo",
  "kablosu",
  "sarj",
  "stand",
  "standi",
  "tutacak",
  "tutacagi",
  "firca",
  "fircasi",
  "canta",
  "cantasi",
  "koruyucu",
  "temperli",
]);

function accessorySignal(title: string): boolean {
  const tokens = foldForCounts(title)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes("icin")) return true;
  return tokens.some((t) => ACCESSORY_TOKENS.has(t));
}

/**
 * Aday başlığı, kaynak ürünün aksesuarı/yedek parçası gibi görünüyor mu?
 * true dönmesi "kesin aksesuar" demek değildir; deterministik kod kabulünün
 * atlanıp kararın AI'a bırakılması gerektiği anlamına gelir.
 */
export function isAccessoryListing(candidateTitle: string, sourceTitle?: string): boolean {
  if (!accessorySignal(candidateTitle)) return false;
  if (sourceTitle && accessorySignal(sourceTitle)) return false;
  return true;
}
