// ============================================
// Rakip arama sorgusu üretimi (saf, test edilebilir)
// ============================================
//
// Kritik hata: ilk scrape başarısız olunca ürün adı geçici olarak "Trendyol
// ürünü" gibi bir placeholder ile kaydedilir; onboarding bu ada göre
// searchKeywords üretir ve metadata'ya DONDURUR. Scrape sonradan gerçek adı
// yazsa bile keywords güncellenmez. Bu jenerik keyword'le Serper 40 alakasız
// ürün döndürür ve hepsi AI tarafından reddedilir → "rakip yok".
//
// Bu modül sorguları CANLI ürün adından kurar ve bayat/jenerik keyword'leri eler.

import { extractProductCodes } from "./competitor-quality";

const RAW_TITLE_MAX_WORDS = 6;

export function truncateRawTitleForSearch(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length <= RAW_TITLE_MAX_WORDS + 1) return title.trim();
  return words.slice(0, RAW_TITLE_MAX_WORDS).join(" ");
}

/**
 * TrackedProduct.metadata JSON'ından AI tarafından üretilmiş searchKeywords'u
 * güvenli şekilde çıkar. `metadata.searchKeywords` veya `metadata.analysis.searchKeywords`.
 */
export function extractSearchKeywords(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as { searchKeywords?: unknown; analysis?: { searchKeywords?: unknown } };
  const raw = Array.isArray(meta.searchKeywords)
    ? meta.searchKeywords
    : Array.isArray(meta.analysis?.searchKeywords)
      ? meta.analysis!.searchKeywords
      : [];
  return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
}

// Marketplace placeholder adları ("Trendyol ürünü", "Hepsiburada", "Diğer" ...).
const GENERIC_NAME_RE =
  /^(trendyol|hepsiburada|amazon(\s*tr)?|n11|pazarama|teknosa|vatan|media\s*markt|mediamarkt|decathlon|ptt\s*avm|çiçeksepeti|ciceksepeti|akakçe|akakce|cimri|epey|boyner|gratis|watsons|kitapyurdu|sephora|koçtaş|koctas|itopya|diğer|diger)\s*(ürünü|urunu|product)?$/i;

// Token bazlı jeneriklik: AI, placeholder addan "Trendyol ürün", "ürünü
// Trendyol", "Trendyol ürünleri" gibi VARYANTLAR türetebiliyor (prod'da
// yaşandı: bu sorgular Serper'a gitti, 120 alakasız aday geldi, hepsi
// reddedildi ve kullanıcı "rakibiniz yok" gördü). Tam-dizgi regex'i bu
// varyantları kaçırır; tokenlara ayırıp HEPSİ marketplace adı veya jenerik
// dolgu sözcüğü ise sorguyu jenerik say.
const MARKETPLACE_TOKENS = new Set([
  "trendyol",
  "hepsiburada",
  "amazon",
  "tr",
  "n11",
  "pazarama",
  "teknosa",
  "vatan",
  "mediamarkt",
  "media",
  "markt",
  "decathlon",
  "ptt",
  "avm",
  "pttavm",
  "ciceksepeti",
  "akakce",
  "cimri",
  "epey",
  "boyner",
  "gratis",
  "watsons",
  "kitapyurdu",
  "sephora",
  "koctas",
  "itopya",
  "diger",
]);

const GENERIC_FILLER_TOKENS = new Set([
  "urun",
  "urunu",
  "urunler",
  "urunleri",
  "product",
  "products",
  "marka",
  "markasi",
  "model",
  "modeller",
  "modelleri",
  "fiyat",
  "fiyati",
  "fiyatlar",
  "fiyatlari",
]);

function foldToken(t: string): string {
  return t
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

export function isGenericQuery(q: string): boolean {
  const trimmed = q.trim();
  // 3 karakter geçerli marka adı olabilir (PS5, JBL, LG) — yalnızca 1-2 karakter ele.
  if (trimmed.length < 3) return true;
  if (GENERIC_NAME_RE.test(trimmed)) return true;
  const tokens = trimmed
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(foldToken);
  if (tokens.length === 0) return true;
  // Tüm tokenlar marketplace adı + jenerik dolgu ise ("trendyol ürünleri",
  // "ürünü trendyol") ürünü tanımlayan hiçbir şey yok demektir.
  return tokens.every((t) => MARKETPLACE_TOKENS.has(t) || GENERIC_FILLER_TOKENS.has(t));
}

function meaningfulTokens(s: string): string[] {
  // Token EŞLEŞTİRME için asciiFold: hem "NIKE"/"Nike" (locale-invariant küçük
  // harf) hem de "Ilık"/"ılık", "Şarjlı"/"sarjli" gibi Türkçe aksan/İ-I-ı
  // farkları normalize edilir; plain toLowerCase "ı"yı çözemediği için eşleşme
  // kaçırırdı. İki taraf da aynı fold'u kullandığından karşılaştırma simetrik.
  return asciiFold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

// Türkçe harfleri ASCII'ye indirger + küçük harfe çevirir. Gürültü sözcüğü
// eşleşmesini büyük/küçük harf ve aksandan bağımsız yapar: "FIRSAT", "Fırsat",
// "fırsat" hepsi "firsat" olur (İ/I/ı ayrışması dahil).
function asciiFold(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

// Ürünü TANIMLAMAYAN pazarlama/lojistik sözcükleri. Arama sorgusunda Google
// Shopping'i alakasız sonuçlara dağıtıyorlar ("Oral-B ... Hediyeli Ücretsiz
// Kargo Orijinal" → marka+model yerine kampanya başlıklarıyla eşleşme). Yalnızca
// ARAMADAN elenir; ürün kimliğini taşıyan boyut/hacim/adet (10ml, 2'li) korunur.
const SEARCH_NOISE_WORDS = new Set([
  "hediye",
  "hediyeli",
  "hediyeniz",
  "ucretsiz",
  "bedava",
  "kargo",
  "hizli",
  "indirim",
  "indirimde",
  "indirimli",
  "indirimi",
  "kampanya",
  "kampanyali",
  "firsat",
  "firsati",
  "outlet",
  "garanti",
  "garantili",
  "garantisi",
  "fatura",
  "faturali",
  "orijinal",
  "orjinal",
  "stokta",
  "stoklarda",
]);

/**
 * Arama sorgusundan pazarlama/lojistik gürültüsünü ayıklar; marka/model/boyutu
 * korur. Her şey elenirse boş/jenerik sorgu üretmemek için orijinali döndürür.
 */
export function stripSearchNoise(name: string): string {
  const kept = name.split(/\s+/).filter((w) => {
    const folded = asciiFold(w.replace(/[^\p{L}\p{N}]+/gu, ""));
    return folded.length === 0 ? true : !SEARCH_NOISE_WORDS.has(folded);
  });
  const result = kept.join(" ").trim();
  return result.length >= 3 ? result : name.trim();
}

/**
 * Arama sorgularını CANLI ürün adından kurar (ground truth). Metadata
 * keywords'ü yalnızca ürün adıyla anlamlı token paylaşıyorsa ekler; böylece
 * bayat "Trendyol ürünü" placeholder'ı elenir, sağlam AI marka/model keyword'ü
 * korunur. Jenerik/çok kısa sorgular asla döndürülmez. En fazla 3 sorgu.
 */
export function buildSearchQueries(
  productName: string,
  fallbackTitle: string,
  metadata: unknown,
): string[] {
  const liveName = (productName || fallbackTitle || "").trim();
  // Pazarlama/lojistik gürültüsü ayıklanmış ad: hem birincil sorgunun 6 kelimelik
  // bütçesi marka/model'e harcanır hem de marka çıkarımı gürültüye takılmaz.
  const cleanName = stripSearchNoise(liveName);
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const q = truncateRawTitleForSearch(raw.trim());
    // Dedup anahtarı locale-INVARIANT küçük harf olmalı: tr-TR "I"→"ı"
    // dönüşümü "NIKE" ile "Nike"yi farklı anahtarlar yapıp dedup'ı bozar.
    const key = q.toLowerCase();
    if (!q || isGenericQuery(q) || seen.has(key)) return;
    seen.add(key);
    queries.push(q);
  };

  // 1) Canlı ürün adı (gürültüsü ayıklanmış) — birincil, geniş sorgu.
  push(cleanName);

  // 1.5) Marka + MODEL KODU/BARKOD sorgusu — birebir aynı ürünü bulmanın en
  //      güvenilir yolu. Ad ilk 6 kelimeye kısaldığında sondaki model kodu
  //      (Lenovo "83SC000QTR") düşüyordu; bu yüzden kodu açıkça hedefliyoruz.
  const codes = extractProductCodes(liveName);
  if (codes.length > 0) {
    const codeTokenSet = new Set(codes.map((c) => c.toLowerCase()));
    const brandWords = cleanName
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !codeTokenSet.has(w.toLowerCase()))
      .slice(0, 2)
      .join(" ");
    push(`${brandWords} ${codes[0]}`.trim());
  }

  // 2) AI keywords — yalnızca canlı adla anlamlı token paylaşanlar (bayat/jenerik
  //    keyword'ü ele). Ad jenerikse token kümesi boş kabul edilir → keyword'ler
  //    olduğu gibi denenir (placeholder ada takılıp keyword'leri kaybetme).
  const liveTokens = isGenericQuery(liveName)
    ? new Set<string>()
    : new Set(meaningfulTokens(liveName));
  for (const kw of extractSearchKeywords(metadata)) {
    const shares = liveTokens.size === 0 || meaningfulTokens(kw).some((t) => liveTokens.has(t));
    if (shares) push(kw);
  }

  return queries.slice(0, 3);
}
