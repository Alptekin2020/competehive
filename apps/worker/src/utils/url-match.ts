/**
 * Host + pathname based URL key so tracking params, casing and www-prefix
 * differences don't break URL matching across Serper / scraper / DB sources.
 * Null-safe: Serper occasionally returns results without a link, which used to
 * throw here and abort own-price recovery on every scheduled scan.
 */
export function urlMatchKey(url: string | null | undefined): string {
  if (typeof url !== "string" || url.length === 0) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

// Query parameters that never change WHICH listing a URL points to. Google
// Shopping appends a fresh `srsltid` to merchant links on every search, and
// marketplaces add campaign/tracking noise — comparing raw URLs then treats the
// same listing as a new competitor (duplicate rows, repeated AI checks) and
// misses price updates for the stored one.
const TRACKING_PARAM_RE =
  /^(utm_.+|srsltid|gclid|gclsrc|gbraid|wbraid|gad_source|gad_campaignid|fbclid|msclkid|dclid|yclid|ref|ref_|tag|adjust_.+|pf_rd_.+|pd_rd_.+|sr|qid|keywords|sprefix|crid|th|psc|linkCode|camp|creative|creativeASIN|ascsubtag|boutiqueId|wt_.+|_gl|_ga|source|spm|scm)$/i;

/**
 * Identity key for a competitor listing: host + path + the query parameters
 * that actually select an offer (Trendyol `merchantId`, Hepsiburada `magaza`,
 * variant ids…), with tracking parameters removed and the rest sorted.
 */
export function competitorUrlKey(url: string | null | undefined): string {
  if (typeof url !== "string" || url.length === 0) return "";
  try {
    const parsed = new URL(url);
    const googleKey = googleShoppingKey(parsed);
    if (googleKey) return googleKey;
    const kept: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAM_RE.test(key)) kept.push([key.toLowerCase(), value]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    const query = kept.map(([k, v]) => `${k}=${v}`).join("&");
    const base = `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
    return query ? `${base}?${query}` : base;
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

// Google Alışveriş ürün kartı bağlantısı ("google.com/search?ibp=oshop&q=…&
// prds=…catalogid:123,…"). `q` arama sorgusudur: aynı ilan farklı sorguda
// farklı URL ile gelir ve ham karşılaştırma her sorguda yeni bir rakip satırı
// açardı (ürün başına onlarca "google.com" satırı). İlanı tanımlayan tek şey
// `prds` içindeki kalıcı kimliklerdir.
// Tercih sırası: ürün kimliği (catalogid/gpcid/productid) kalıcıdır; teklif
// kimliği en ucuz satıcı değiştikçe değişebildiği için son çaredir.
const GOOGLE_ID_PRIORITY = ["catalogid", "gpcid", "productid", "headlineofferdocid"];

function googleShoppingKey(parsed: URL): string | null {
  if (!/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname)) return null;
  const prds = parsed.searchParams.get("prds");
  if (!prds) return null;
  const ids = new Map<string, string>();
  for (const part of prds.split(",")) {
    const sep = part.indexOf(":");
    if (sep <= 0) continue;
    const name = part.slice(0, sep).trim().toLowerCase();
    const value = part.slice(sep + 1).trim();
    if (value && !ids.has(name)) ids.set(name, value);
  }
  for (const name of GOOGLE_ID_PRIORITY) {
    const value = ids.get(name);
    if (value) return `google.com/shopping?${name}=${value}`;
  }
  return null;
}
