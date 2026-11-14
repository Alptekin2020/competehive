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
