// Aynı ilanı birden çok satıcının sattığı pazaryerleri (Trendyol, Hepsiburada,
// Amazon, N11, Pazarama, PttAVM): ilanın satıcı parametreleri, sayfanın
// gösterdiği satıcı ve Amazon'un "Tüm teklifler" (AOD) listesi. Vatan, Teknosa
// ve MediaMarkt kendi stoğunu satan perakendecilerdir; burada yer almaz.

import * as cheerio from "cheerio";

import type { ScrapedOtherSeller } from "../scrapers";

export type SellerMarketplace =
  | "TRENDYOL"
  | "HEPSIBURADA"
  | "AMAZON_TR"
  | "N11"
  | "PAZARAMA"
  | "PTTAVM";

const SELLER_MARKETPLACE_HOSTS: ReadonlyArray<[RegExp, SellerMarketplace]> = [
  [/(^|\.)trendyol\.com$/i, "TRENDYOL"],
  [/(^|\.)hepsiburada\.com$/i, "HEPSIBURADA"],
  [/(^|\.)amazon\.com\.tr$/i, "AMAZON_TR"],
  [/(^|\.)n11\.com$/i, "N11"],
  [/(^|\.)pazarama\.com$/i, "PAZARAMA"],
  [/(^|\.)pttavm\.com$/i, "PTTAVM"],
];

export const SELLER_MARKETPLACE_LABELS: Record<SellerMarketplace, string> = {
  TRENDYOL: "Trendyol",
  HEPSIBURADA: "Hepsiburada",
  AMAZON_TR: "Amazon",
  N11: "N11",
  PAZARAMA: "Pazarama",
  PTTAVM: "PttAVM",
};

function parseUrl(url: string | null | undefined): URL | null {
  try {
    return new URL(url ?? "");
  } catch {
    return null;
  }
}

/** URL'nin ait olduğu çok satıcılı pazaryeri (değilse null). */
export function sellerMarketplaceForUrl(url: string | null | undefined): SellerMarketplace | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  for (const [re, marketplace] of SELLER_MARKETPLACE_HOSTS) {
    if (re.test(parsed.hostname)) return marketplace;
  }
  return null;
}

function param(parsed: URL, name: string): string | null {
  const value = parsed.searchParams.get(name);
  return value && value.trim() ? value.trim() : null;
}

/**
 * URL belirli bir satıcıyı seçiyor mu: Trendyol `merchantId`, Hepsiburada/N11
 * `magaza`, Amazon `smid`/`m`. Seçiyorsa sayfanın gösterdiği satıcı o satıcıdır
 * ve buybox "sayfa satıcısı" sayılmaz.
 */
export function urlPinsSeller(url: string | null | undefined): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (param(parsed, "merchantId") || param(parsed, "magaza")) return true;
  return sellerMarketplaceForUrl(url) === "AMAZON_TR" && !!amazonSellerIdFromUrl(url);
}

/** Amazon URL'sindeki ASIN (`/dp/<ASIN>`, `/gp/product/<ASIN>`). */
export function amazonAsinFromUrl(url: string | null | undefined): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const match = parsed.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

/** Amazon URL'sindeki satıcı kimliği (`smid`, yoksa `m`). */
export function amazonSellerIdFromUrl(url: string | null | undefined): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  return param(parsed, "smid") ?? param(parsed, "m");
}

/** Amazon.com.tr'nin kendi satıcı kimliği (prod 20 Kasım, `#merchantID`). */
export const AMAZON_TR_MERCHANT_ID = "A1UNQM1SR2CHM";

/** Amazon "Tüm teklifler" panelinin (AOD) HTML parçasını veren adres. */
export function amazonOffersUrl(url: string): string | null {
  const parsed = parseUrl(url);
  const asin = amazonAsinFromUrl(url);
  if (!parsed || !asin) return null;
  return `${parsed.origin}/gp/product/ajax/aodAjaxMain/?asin=${asin}&pc=dp&experienceId=aodAjaxMain`;
}

function parseTrPrice(text: string): number {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  // "1.299,90" → 1299.9; "1299.90" → 1299.9
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /\.\d{3}$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}

/** Amazon satıcı bağlantısındaki satıcı kimliği (`seller=` / `smid=`). */
function sellerIdFromHref(href: string | undefined): string | null {
  const match = (href ?? "").match(/[?&](?:seller|smid)=([A-Z0-9]{8,20})/i);
  return match ? match[1].toUpperCase() : null;
}

/** Ürün sayfasının gösterdiği (buybox) Amazon satıcısının kimliği ve adı. */
export function amazonShownMerchant(
  html: string,
): { merchantId: string | null; sellerName: string | null } | null {
  const $ = cheerio.load(html);
  const merchantId =
    ($("#merchantID").attr("value") || $('input[name="merchantID"]').attr("value") || "").trim() ||
    sellerIdFromHref($("#sellerProfileTriggerId").attr("href")) ||
    html.match(/"merchantID"\s*:\s*"([A-Z0-9]{8,20})"/)?.[1] ||
    null;
  const sellerName = $("#sellerProfileTriggerId").text().replace(/\s+/g, " ").trim() || null;
  if (!merchantId && !sellerName) return null;
  return { merchantId, sellerName };
}

/**
 * Amazon AOD parçasındaki diğer teklifler (`#aod-offer`). Sabitlenmiş buybox
 * teklifi (`#aod-pinned-offer`) sayfanın gösterdiği satıcıdır ve listeye
 * girmez. Amazon'un kendisi bağlantısız satıcı adıyla görünür; kimliği yoksa
 * normalleştirilmiş adı kullanılır.
 */
export function parseAmazonOffers(html: string): ScrapedOtherSeller[] {
  const $ = cheerio.load(html);
  const out: ScrapedOtherSeller[] = [];
  const seen = new Set<string>();
  $('[id="aod-offer"]').each((_, el) => {
    const offer = $(el);
    const soldBy = offer.find('[id="aod-offer-soldBy"]');
    const link = soldBy.find("a").first();
    const sellerName =
      link.text().replace(/\s+/g, " ").trim() ||
      soldBy
        .find(".a-col-right .a-size-small, .a-col-right span")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim() ||
      null;
    const merchantId =
      sellerIdFromHref(link.attr("href")) ||
      (sellerName && /^amazon(\.com)?\.tr$/i.test(sellerName) ? AMAZON_TR_MERCHANT_ID : null) ||
      (sellerName ? `name:${sellerName.toLocaleLowerCase("tr-TR").replace(/\s+/g, "")}` : null);
    const price = parseTrPrice(
      offer.find(".a-price .a-offscreen").first().text() ||
        offer.find('[id^="aod-price"] .a-offscreen').first().text(),
    );
    if (!merchantId || price <= 0 || seen.has(merchantId)) return;
    seen.add(merchantId);
    out.push({ merchantId, sellerName, price });
  });
  return out;
}

/**
 * N11 sayfasının gösterdiği satıcının kısa adı (`magaza`): kaçışlı durumda
 * `productUrlWithoutSellerShop` alanından hemen önceki ürün adresinin `magaza`
 * parametresi (prod 20 Kasım: "…-64270488?magaza=kustarsuarmaturleri",
 * "productUrlWithoutSellerShop":…). Satıcı listesindeki adresler bu alanın
 * önünde durmaz.
 */
export function n11ShownSellerSlug(html: string): string | null {
  const idx = html.indexOf("productUrlWithoutSellerShop");
  if (idx === -1) return null;
  const before = html.slice(Math.max(0, idx - 400), idx);
  const matches = [...before.matchAll(/[?&]magaza=([A-Za-z0-9_.-]+)/g)];
  const slug = matches.length > 0 ? matches[matches.length - 1][1] : null;
  return slug && slug.length >= 2 ? slug : null;
}

/**
 * N11 "Diğer Mağazalar" bloğundaki satıcılar (`.otherSellers`): her kartta
 * `?magaza=<kısa ad>` bağlantısı, `.name` görünen ad ve fiyat. Fiyatı
 * okunamayan kart atlanır.
 */
export function parseN11OtherSellers(html: string): ScrapedOtherSeller[] {
  const $ = cheerio.load(html);
  const out: ScrapedOtherSeller[] = [];
  const seen = new Set<string>();
  $(".otherSellers .swiper-slide, .otherSellers [data-index]").each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="magaza="]').first().attr("href") ?? "";
    const slug = href.match(/[?&]magaza=([A-Za-z0-9_.-]+)/)?.[1];
    if (!slug || seen.has(slug)) return;
    const sellerName = card.find(".name").first().text().replace(/\s+/g, " ").trim() || slug;
    const priceText =
      card.find("ins").first().text() ||
      card.find("[class*='price' i], [class*='Price']").first().text() ||
      "";
    const price = parseTrPrice(priceText);
    if (price <= 0) return;
    seen.add(slug);
    out.push({ merchantId: slug, sellerName, price });
  });
  return out;
}

/** Ayarlar'daki ad gibi karşılaştırma: tr-TR küçük harf, boşluksuz. */
function foldName(name: string | null | undefined): string {
  return (name ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (ch) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[ch] ?? ch)
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Gösterilen satıcıyı (kimlik ya da ad) diğer satıcılardan çıkarır. */
export function withoutShownSeller(
  sellers: readonly ScrapedOtherSeller[],
  shown: { merchantId: string | null; sellerName: string | null } | null,
): ScrapedOtherSeller[] {
  if (!shown) return [...sellers];
  const shownName = foldName(shown.sellerName);
  return sellers.filter(
    (seller) =>
      !(shown.merchantId && seller.merchantId === shown.merchantId) &&
      !(shownName && foldName(seller.sellerName) === shownName),
  );
}

/** Tanı için satıcı verisi anahtarları (pazaryeri başına). */
export const SELLER_DIAGNOSTIC_KEYS: Record<SellerMarketplace, readonly string[]> = {
  TRENDYOL: [],
  HEPSIBURADA: [],
  AMAZON_TR: ["aod-offer", "olp", "merchantID", "sellerProfileTriggerId", "Diğer satıcılar"],
  N11: [
    "otherSellers",
    "sellerList",
    "sellers",
    "shopName",
    "sellerName",
    "magaza=",
    "Diğer Satıcılar",
    "Diğer satıcılar",
    "offerCount",
  ],
  PAZARAMA: [
    "otherSellers",
    "merchants",
    "sellers",
    "merchantName",
    "sellerName",
    "storeName",
    "Diğer Satıcılar",
    "Diğer satıcılar",
    "__NEXT_DATA__",
  ],
  PTTAVM: [
    "otherSellers",
    "sellers",
    "shopName",
    "shop_name",
    "storeName",
    "sellerName",
    "magaza",
    "Diğer Satıcılar",
    "Diğer satıcılar",
  ],
};
