import {
  MARKETPLACES,
  SUPPORTED_SCRAPER_MARKETPLACES,
  isGenericStoreMarketplace,
  storeHostFromUrl,
} from "@competehive/shared";

export const MARKETPLACE_VALUES = [
  ...SUPPORTED_SCRAPER_MARKETPLACES,
  "CICEKSEPETI",
  "PTTAVM",
  "AKAKCE",
  "CIMRI",
  "EPEY",
  "BOYNER",
  "GRATIS",
  "WATSONS",
  "KITAPYURDU",
  "DECATHLON",
  "TEKNOSA",
  "MEDIAMARKT",
  "SEPHORA",
  "KOCTAS",
  "VATAN",
  "ITOPYA",
  "SHOPIFY",
  "CUSTOM",
] as const;

export type MarketplaceValue = (typeof MARKETPLACE_VALUES)[number];

export const SUPPORTED_MARKETPLACES = [...SUPPORTED_SCRAPER_MARKETPLACES] as const;

const MARKETPLACE_DOMAIN_MAP: Array<{ keyword: string; marketplace: MarketplaceValue }> = [
  ...Object.values(MARKETPLACES).map((marketplace) => ({
    keyword: marketplace.domain,
    marketplace: marketplace.id as MarketplaceValue,
  })),
  { keyword: "ciceksepeti.com", marketplace: "CICEKSEPETI" },
  { keyword: "pttavm.com", marketplace: "PTTAVM" },
  { keyword: "akakce.com", marketplace: "AKAKCE" },
  { keyword: "cimri.com", marketplace: "CIMRI" },
  { keyword: "epey.com", marketplace: "EPEY" },
  { keyword: "boyner.com", marketplace: "BOYNER" },
  { keyword: "gratis.com", marketplace: "GRATIS" },
  { keyword: "watsons.com", marketplace: "WATSONS" },
  { keyword: "kitapyurdu.com", marketplace: "KITAPYURDU" },
  { keyword: "decathlon.com", marketplace: "DECATHLON" },
  { keyword: "teknosa.com", marketplace: "TEKNOSA" },
  { keyword: "mediamarkt.com", marketplace: "MEDIAMARKT" },
  { keyword: "sephora.com", marketplace: "SEPHORA" },
  { keyword: "koctas.com", marketplace: "KOCTAS" },
  { keyword: "vatanbilgisayar.com", marketplace: "VATAN" },
  { keyword: "itopya.com", marketplace: "ITOPYA" },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Alan adı yalnızca HOSTNAME üzerinde ve etiket sınırında eşleşir. Tüm URL'de
// "includes" araması, kendi-site linklerini yanlış pazaryerine atıyordu
// (ör. https://seninev.com/?ref=trendyol.com → TRENDYOL).
const MARKETPLACE_HOST_PATTERNS = MARKETPLACE_DOMAIN_MAP.filter(({ keyword }) => keyword).map(
  ({ keyword, marketplace }) => ({
    pattern: new RegExp(`(^|\\.)${escapeRegExp(keyword.toLowerCase())}(\\.|$)`),
    marketplace,
  }),
);

export function detectMarketplaceFromUrl(url: string): MarketplaceValue {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "CUSTOM";
  }
  const found = MARKETPLACE_HOST_PATTERNS.find(({ pattern }) => pattern.test(host));
  return found?.marketplace ?? "CUSTOM";
}

const SCRAPER_SUPPORTED_SET = new Set<string>(SUPPORTED_SCRAPER_MARKETPLACES);

/** True when the marketplace has worker scraper support (see worker getScraper). */
export function isScraperSupportedMarketplace(marketplace: string): boolean {
  return SCRAPER_SUPPORTED_SET.has(marketplace);
}

/** Human-readable, comma-separated list of supported marketplace names. */
export const SUPPORTED_MARKETPLACE_LABEL = SUPPORTED_SCRAPER_MARKETPLACES.map(
  (id) => MARKETPLACES[id]?.name ?? id,
).join(", ");

/**
 * True when new products may be added for this marketplace: either a dedicated
 * scraper exists, or it is an independent store site (CUSTOM/SHOPIFY) scraped
 * via the generic JSON-LD/meta parser. Comparison sites (Akakçe, Cimri, …) and
 * DECATHLON stay rejected.
 */
export function isTrackableMarketplace(marketplace: string): boolean {
  return isScraperSupportedMarketplace(marketplace) || isGenericStoreMarketplace(marketplace);
}

/**
 * Plan "pazaryeri" limiti için mağaza kimliği: bilinen pazaryerlerinde enum
 * değeri, bağımsız sitelerde alan adı. Böylece iki farklı kendi-site tek bir
 * "CUSTOM" pazaryeri sayılmaz.
 */
export function storeKey(marketplace: string, url: string): string {
  if (!isGenericStoreMarketplace(marketplace)) return marketplace;
  return `store:${storeHostFromUrl(url) ?? marketplace}`;
}

/** Badge label override for independent stores (domain instead of "Diğer"). */
export function storeBadgeName(marketplace: string, url: string | null | undefined) {
  if (!url || !isGenericStoreMarketplace(marketplace)) return undefined;
  return storeHostFromUrl(url) ?? undefined;
}

/** Human-readable store name: marketplace label or the store's domain. */
export function storeDisplayName(marketplace: string, url: string): string {
  return storeBadgeName(marketplace, url) ?? MARKETPLACES[marketplace]?.name ?? marketplace;
}
