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

export function isGenericQuery(q: string): boolean {
  const trimmed = q.trim();
  // 3 karakter geçerli marka adı olabilir (PS5, JBL, LG) — yalnızca 1-2 karakter ele.
  if (trimmed.length < 3) return true;
  return GENERIC_NAME_RE.test(trimmed);
}

function meaningfulTokens(s: string): string[] {
  // Token EŞLEŞTİRME için locale-invariant küçük harf: tr-TR "I"→"ı" dönüşümü
  // "NIKE" ile "Nike"yi farklı token yapıp eşleşmeyi kaçırırdı.
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
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

  // 1) Canlı ürün adı — birincil, geniş sorgu.
  push(liveName);

  // 1.5) Marka + MODEL KODU/BARKOD sorgusu — birebir aynı ürünü bulmanın en
  //      güvenilir yolu. Ad ilk 6 kelimeye kısaldığında sondaki model kodu
  //      (Lenovo "83SC000QTR") düşüyordu; bu yüzden kodu açıkça hedefliyoruz.
  const codes = extractProductCodes(liveName);
  if (codes.length > 0) {
    const codeTokenSet = new Set(codes.map((c) => c.toLowerCase()));
    const brandWords = liveName
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
