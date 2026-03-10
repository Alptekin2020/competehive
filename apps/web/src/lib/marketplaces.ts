import { MARKETPLACES, SUPPORTED_SCRAPER_MARKETPLACES } from "@competehive/shared";

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

export function detectMarketplaceFromUrl(url: string): MarketplaceValue {
  const lower = url.toLowerCase();
  const found = MARKETPLACE_DOMAIN_MAP.find(({ keyword }) => lower.includes(keyword));
  return found?.marketplace ?? "CUSTOM";
}
