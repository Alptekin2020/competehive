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

// Kısaltılmış sorgunun sonunda asılı kalan bağlaç/edat ve noktalama: "Oral-B
// Şarjlı Vitality Pro Koruma ve" ya da "Artema Maestro A42146 Pull-Out Eviye
// Bataryası," gibi sorgular Google Shopping'de gereksiz yere daralıyor.
const DANGLING_TAIL_WORDS = new Set(["ve", "ile", "icin", "veya", "ya", "da", "de", "and", "with"]);

function trimDanglingTail(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1) {
    const last = out[out.length - 1];
    const bare = last.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
    if (bare.length === 0 || DANGLING_TAIL_WORDS.has(foldToken(bare))) {
      out.pop();
      continue;
    }
    // Sondaki virgül/tire/iki nokta kelimeden ayıklanır ("Bataryası," → "Bataryası").
    out[out.length - 1] = last.replace(/[,;:\-–—|/]+$/u, "");
    break;
  }
  return out;
}

// "2'si 1 arada", "3'ü 1 Arada", "2 si 1 arada": tek bir anlam birimi —
// kısaltma asla ortasından kesmez (eski sorgu "Erbatab Vitamin D3 K2 2'si 1").
const IN_ONE_RE = /^\d['’`]?(?:s[ıiuü]|[ıiuü]|y[ıiuü])?$/iu;

/** Başlığı kelime birimlerine böler; "N'si 1 arada" üç kelimesi tek birimdir. */
function toUnits(words: string[]): string[] {
  const units: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const after = words[i + 2];
    if (IN_ONE_RE.test(w) && next === "1" && after && foldToken(after) === "arada") {
      units.push(`${w} ${next} ${after}`);
      i += 2;
      continue;
    }
    // "2 si 1 arada" yazımı (kesme işaretsiz).
    if (
      /^\d$/.test(w) &&
      next &&
      /^(?:s[ıiuü]|[ıiuü])$/iu.test(next) &&
      words[i + 2] === "1" &&
      words[i + 3] &&
      foldToken(words[i + 3]) === "arada"
    ) {
      units.push(`${w} ${next} 1 ${words[i + 3]}`);
      i += 3;
      continue;
    }
    units.push(w);
  }
  return units;
}

// Sorguda ürünü tanımlamayan teknik ölçüler (güç, voltaj, boyut…): Google
// Shopping başlıkları bunları farklı yazar ya da hiç yazmaz; 6 kelimelik
// bütçeyi ürün tipinden çalıyorlar. Hacim/ağırlık/adet (20 ml, 100 gr, 2'li)
// paketi tanımladığı için KORUNUR.
const SPEC_UNIT_RE = /^(?:w|watt|v|volt|hz|mah|cm|mm|rpm|dpi|bar|kw|btu)$/;
const SPEC_INLINE_RE = /^\d+(?:[.,]\d+)?(?:w|watt|v|volt|hz|mah|cm|mm|rpm|dpi|bar|kw|btu)$/;

const SPEC_LABEL_RE =
  /^(?:yukseklik|yuksekligi|genislik|genisligi|uzunluk|uzunlugu|derinlik|cap|capi|guc|gucu)$/;

function dropSpecNoise(units: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i].replace(/[,;]+$/u, "");
    if (unit.length === 0 || /^[,;:|\-–—]+$/u.test(unit)) continue;
    const folded = foldToken(unit);
    if (SPEC_INLINE_RE.test(folded)) continue;
    const next = units[i + 1] ? foldToken(units[i + 1].replace(/[,;]+$/u, "")) : "";
    if (/^\d+(?:[.,]\d+)?$/.test(folded) && SPEC_UNIT_RE.test(next)) {
      i++;
      // Ölçünün etiketi de düşer: "24 cm Yükseklik".
      if (units[i + 1] && SPEC_LABEL_RE.test(foldToken(units[i + 1]))) i++;
      continue;
    }
    out.push(unit);
  }
  return out;
}

// Ürün TİPİ sözcükleri (başlığın baş ismi). Kısaltmada düşerse arama başka
// ürünlere kayıyor: "KUSTAR 3 Fonksiyonlu Oynar Başlıklı Krom" → batarya
// yerine duş başlıkları; "Pati Clean 20 Lt Kokusuz Bentonit" → kedi kumu yok.
const HEAD_NOUNS = new Set([
  "batarya",
  "bataryasi",
  "damla",
  "damlasi",
  "kumu",
  "makine",
  "makinesi",
  "makinasi",
  "isitici",
  "isiticisi",
  "supurge",
  "supurgesi",
  "firca",
  "fircasi",
  "tencere",
  "tava",
  "krem",
  "kremi",
  "sampuan",
  "sampuani",
  "serum",
  "serumu",
  "jel",
  "sprey",
  "kapsul",
  "tablet",
  "surup",
  "vantilator",
  "televizyon",
  "tv",
  "kulaklik",
  "telefon",
  "laptop",
  "bilgisayar",
  "monitor",
  "saat",
  "ayakkabi",
  "cikolata",
  "kahve",
  "mama",
  "mamasi",
  "deterjan",
  "deterjani",
  "parfum",
  "pudra",
  "ruj",
  "maskara",
  "fondoten",
]);

/** Birim bir ürün tipi sözcüğü mü? Liste + Türkçe tamlama eki (-ası/-esi). */
function isHeadNoun(unit: string): boolean {
  const folded = foldToken(unit.replace(/[^\p{L}\p{N}]+/gu, ""));
  if (HEAD_NOUNS.has(folded)) return true;
  return folded.length >= 7 && /[aeiou]s[iu]$/.test(folded) && !/\d/.test(folded);
}

/** Son ürün tipi birimi + (varsa) onu niteleyen önceki birim: "Evye Bataryası", "Kedi Kumu". */
function headPhraseIndex(units: string[]): { start: number; end: number } | null {
  for (let i = units.length - 1; i >= 1; i--) {
    if (!isHeadNoun(units[i])) continue;
    const isModifier = (j: number) =>
      j >= 1 && (/^\p{L}[\p{L}'’-]*$/u.test(units[j]) || units[j].includes(" "));
    if (!isModifier(i - 1)) return { start: i, end: i };
    // Tamlama zinciri: "Türk Kahvesi Makinesi" — önceki birim de tamlamaysa bir
    // niteleyici daha alınır.
    const start = isHeadNoun(units[i - 1]) && isModifier(i - 2) ? i - 2 : i - 1;
    return { start, end: i };
  }
  return null;
}

export function truncateRawTitleForSearch(title: string): string {
  const units = dropSpecNoise(toUnits(title.trim().split(/\s+/)));
  if (units.length <= RAW_TITLE_MAX_WORDS + 1) return trimDanglingTail(units).join(" ");
  const head = headPhraseIndex(units);
  // Baş isim ilk 6 birimin dışında kaldıysa: ilk birimler + baş isim öbeği
  // (en fazla 7 birim) — ürün tipi sorgudan asla düşmez.
  if (head && head.end >= RAW_TITLE_MAX_WORDS) {
    const phrase = units.slice(head.start, head.end + 1);
    const leadCount = Math.max(1, RAW_TITLE_MAX_WORDS + 1 - phrase.length);
    const lead = trimDanglingTail(units.slice(0, Math.min(leadCount, head.start)));
    return [...lead, ...phrase].join(" ");
  }
  return trimDanglingTail(units.slice(0, RAW_TITLE_MAX_WORDS)).join(" ");
}

/** Başlığın baş isim öbeği ("Evye Bataryası") — marka + ürün tipi sorgusu için. */
export function extractHeadPhrase(title: string): string | null {
  const units = dropSpecNoise(toUnits(title.trim().split(/\s+/)));
  const head = headPhraseIndex(units);
  return head ? units.slice(head.start, head.end + 1).join(" ") : null;
}

// Pazaryerlerinin sayfa başlığına eklediği SEO kalıpları. Ürün adına karışınca
// hem arama sorgusunu hem AI eşleştirmesini bozuyor (prod: Hepsiburada "Oral-B
// … Diş Fırçası Lila Fiyatları ve Özellikleri").
const TITLE_SEO_SUFFIX_RE =
  /\s*(?:[-–—|:]\s*)?(?:fiyat[ıi]?(?:lar[ıi])?(?:\s*(?:,|ve)\s*(?:özellikleri|yorumlar[ıi]|modelleri|taksit\s+seçenekleri))*|özellikleri\s+ve\s+fiyat[ıi]?|en\s+uygun\s+fiyat(?:lar)?(?:la)?|sat[ıi]n\s+al)\s*$/iu;
const TITLE_MARKETPLACE_SUFFIX_RE =
  /\s*[-–—|]\s*(?:trendyol|hepsiburada(?:\.com)?|amazon(?:\.com\.tr)?|n11(?:\.com)?|pazarama|teknosa|vatan\s+bilgisayar|mediamarkt|pttavm|ptt\s+avm|çiçeksepeti|ciceksepeti)\s*$/iu;

/**
 * Ürün başlığından pazaryeri SEO eklerini ayıklar. Her şey silinirse (başlık
 * yalnızca ekten ibaretse) orijinali döndürür.
 */
export function cleanProductTitle(title: string): string {
  const original = (title || "").trim();
  let cleaned = original;
  for (let i = 0; i < 3; i++) {
    const next = cleaned
      .replace(TITLE_MARKETPLACE_SUFFIX_RE, "")
      .replace(TITLE_SEO_SUFFIX_RE, "")
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  cleaned = cleaned.replace(/[\s,;:\-–—|]+$/u, "").trim();
  return cleaned.length >= 3 ? cleaned : original;
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
  // Toplu eklemenin eski yer tutucu adı ("Yükleniyor..."): ilk taraması
  // başarısız olan ürünlerde kalıcılaşıp Serper'a sorgu olarak gidiyordu.
  "yukleniyor",
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
  "model",
  "modeli",
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

// İki kelimelik markalar: ilk kelime tek başına marka değildir.
const MULTI_WORD_BRANDS = ["kahve dunyasi", "pati clean"];

/** Marka: metadata.brand adın başındaysa o; değilse bilinen iki kelimelik marka ya da ilk kelime. */
function brandOf(name: string, metadata: unknown): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const metaBrand =
    metadata && typeof metadata === "object" ? (metadata as { brand?: unknown }).brand : undefined;
  if (typeof metaBrand === "string" && metaBrand.trim()) {
    const bw = metaBrand.trim().split(/\s+/);
    const prefix = words.slice(0, bw.length).join(" ");
    if (asciiFold(prefix) === asciiFold(bw.join(" "))) return prefix;
  }
  const firstTwo = asciiFold(words.slice(0, 2).join(" "));
  if (MULTI_WORD_BRANDS.includes(firstTwo)) return words.slice(0, 2).join(" ");
  return words[0];
}

/**
 * Model kodunun başlıktaki TAM yazımı: "EP3347/90" (kod çıkarımı "/90" ekini
 * atabilir; ek konfigürasyonu belirler, sorguda korunmalı).
 */
function fullCodeToken(name: string, code: string): string {
  const lc = code.toLowerCase();
  for (const raw of name.split(/\s+/)) {
    const w = raw.replace(/^[\p{P}\p{S}]+|[,;:)(]+$/gu, "");
    if (w.toLowerCase().includes(lc)) return w;
  }
  return code;
}

/** metadata.gtin / ean / barcode: 8–14 haneli barkod. */
export function extractGtin(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  for (const key of ["gtin", "ean", "barcode", "gtin13"]) {
    const v = meta[key];
    const digits = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
    if (/^\d{8,14}$/.test(digits)) return digits;
  }
  return null;
}

/**
 * Arama sorgularını CANLI ürün adından kurar (ground truth). Sıra:
 * 1) marka + tam model kodu ("Philips EP3347/90") — birebir ürünü bulmanın en
 *    güvenilir yolu, kod varsa her zaman ilk sorgu;
 * 2) gürültüsü ayıklanmış canlı ad (baş isim korunarak kısaltılmış);
 * 3) barkod (metadata'da varsa, çıplak GTIN);
 * 4) marka + ürün tipi ("KUSTAR Evye Bataryası");
 * 5) ürün adıyla token paylaşan AI keyword'leri; 6) ilk 4 kelime.
 * Jenerik/çok kısa sorgular asla döndürülmez. En fazla 4 sorgu.
 */
export function buildSearchQueries(
  productName: string,
  fallbackTitle: string,
  metadata: unknown,
): string[] {
  const liveName = cleanProductTitle(productName || fallbackTitle || "");
  // Pazarlama/lojistik gürültüsü ayıklanmış ad: hem birincil sorgunun 6 kelimelik
  // bütçesi marka/model'e harcanır hem de marka çıkarımı gürültüye takılmaz.
  const cleanName = stripSearchNoise(liveName);
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string, truncate = true) => {
    const q = truncate ? truncateRawTitleForSearch(raw.trim()) : raw.trim();
    // Dedup anahtarı locale-INVARIANT küçük harf olmalı: tr-TR "I"→"ı"
    // dönüşümü "NIKE" ile "Nike"yi farklı anahtarlar yapıp dedup'ı bozar.
    const key = q.toLowerCase();
    if (!q || seen.has(key)) return;
    if (truncate && isGenericQuery(q)) return;
    seen.add(key);
    queries.push(q);
  };

  const nameIsGeneric = isGenericQuery(liveName);
  const brand = nameIsGeneric ? "" : brandOf(cleanName, metadata);

  // 1) Marka + TAM model kodu.
  const codes = nameIsGeneric ? [] : extractProductCodes(liveName);
  if (codes.length > 0) {
    const code = fullCodeToken(cleanName, codes[0]);
    const brandPart = brand && !brand.toLowerCase().includes(code.toLowerCase()) ? brand : "";
    push(`${brandPart} ${code}`.trim());
  }

  // 2) Canlı ürün adı (gürültüsü ayıklanmış).
  push(cleanName);

  // 3) Barkod: çıplak GTIN Google Shopping'de birebir ürünü bulur.
  const gtin = extractGtin(metadata);
  if (gtin) push(gtin, false);

  // 4) Marka + ürün tipi.
  const head = nameIsGeneric ? null : extractHeadPhrase(cleanName);
  if (brand && head && !asciiFold(brand).includes(asciiFold(head))) {
    push(`${brand} ${head}`);
  }

  // 5) AI keywords — yalnızca canlı adla anlamlı token paylaşanlar (bayat/jenerik
  //    keyword'ü ele). Ad jenerikse token kümesi boş kabul edilir → keyword'ler
  //    olduğu gibi denenir (placeholder ada takılıp keyword'leri kaybetme).
  const liveTokens = nameIsGeneric ? new Set<string>() : new Set(meaningfulTokens(liveName));
  for (const kw of extractSearchKeywords(metadata)) {
    const shares = liveTokens.size === 0 || meaningfulTokens(kw).some((t) => liveTokens.has(t));
    if (shares) push(kw);
  }

  // 6) Yedek geniş sorgu: adın ilk 4 kelimesi (marka + ürün ailesi).
  if (queries.length < 2) {
    const words = cleanName.split(/\s+/).filter(Boolean);
    if (words.length > 4) push(words.slice(0, 4).join(" "));
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
}

export const MAX_SEARCH_QUERIES = 4;
