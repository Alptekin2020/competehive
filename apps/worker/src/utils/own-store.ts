// Kullanıcının kendi mağazası (Ayarlar → "Mağaza adım": pazaryeri başına users.own_stores,
// adı girilmemiş pazaryerinde tüm pazaryerleri için users.own_store_names).
//
// Aynı ilanı birden çok satıcı satar. Sayfanın gösterdiği satıcı (buybox) her
// zaman kullanıcı değildir: kullanıcı ilandaki diğer satıcılardan biriyse kendi
// fiyatı o satırdan okunur, sayfanın gösterdiği satıcı rakip olur ve kendi
// mağazası hiçbir zaman rakip sayılmaz.

import type { ScrapedOtherSeller, ScrapedProduct } from "../scrapers";

/** Karşılaştırma için mağaza adı: tr-TR küçük harf, harf/rakam dışı her şey atılır. */
export function normalizeStoreName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLocaleLowerCase("tr-TR")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Ad, kullanıcının mağazalarından biri mi (tam eşleşme, büyük/küçük harf ve boşluk farkı yok). */
export function isOwnStoreName(
  name: string | null | undefined,
  ownStoreNames: readonly string[],
): boolean {
  const key = normalizeStoreName(name);
  if (key.length < 2) return false;
  return ownStoreNames.some((own) => normalizeStoreName(own) === key);
}

export type OwnStoreOutcome =
  /** Mağaza adı yok ya da sayfada satıcı bilgisi yok: davranış değişmez. */
  | "none"
  /** Sayfanın gösterdiği satıcı kullanıcının mağazası. */
  | "page-is-own"
  /** Kullanıcı diğer satıcılardan biri: fiyat onun satırından okundu. */
  | "own-from-list"
  /** Kullanıcının mağazası bu ilanda görünmüyor: sayfa fiyatı kalır. */
  | "not-listed";

export interface OwnStoreResolution {
  product: ScrapedProduct;
  outcome: OwnStoreOutcome;
  /** Fiyatın okunduğu kendi mağaza adı (own-from-list / page-is-own). */
  ownSeller: string | null;
}

/**
 * Kazıma sonucunu kullanıcının mağaza adlarına göre düzeltir (saf fonksiyon).
 * Diğer satıcılardan kullanıcının mağazası her durumda çıkarılır.
 */
export function applyOwnStore(
  scraped: ScrapedProduct,
  ownStoreNames: readonly string[],
): OwnStoreResolution {
  const names = ownStoreNames.filter((name) => normalizeStoreName(name).length >= 2);
  if (names.length === 0) return { product: scraped, outcome: "none", ownSeller: null };

  const sellers = scraped.otherSellers ?? [];
  const rivals = sellers.filter((seller) => !isOwnStoreName(seller.sellerName, names));
  const page = scraped.pageSeller ?? null;

  if (page && isOwnStoreName(page.sellerName, names)) {
    return {
      product: { ...scraped, otherSellers: rivals },
      outcome: "page-is-own",
      ownSeller: page.sellerName,
    };
  }

  const own = sellers
    .filter((seller) => isOwnStoreName(seller.sellerName, names) && seller.price > 0)
    .sort((a, b) => a.price - b.price)[0];
  if (own && page) {
    const pageRival: ScrapedOtherSeller | null =
      scraped.price > 0
        ? {
            merchantId: page.merchantId ?? normalizeStoreName(page.sellerName),
            sellerName: page.sellerName,
            price: scraped.price,
          }
        : null;
    const nextRivals =
      pageRival && !rivals.some((r) => r.merchantId === pageRival.merchantId)
        ? [pageRival, ...rivals]
        : rivals;
    return {
      product: {
        ...scraped,
        price: own.price,
        sellerName: own.sellerName ?? scraped.sellerName,
        inStock: true,
        otherSellers: nextRivals,
      },
      outcome: "own-from-list",
      ownSeller: own.sellerName,
    };
  }

  if (!page && sellers.length === 0) {
    return { product: scraped, outcome: "none", ownSeller: null };
  }
  return {
    product: { ...scraped, otherSellers: rivals },
    outcome: page ? "not-listed" : "none",
    ownSeller: null,
  };
}

/** Rakip satırının satıcı adı: `matchAttributes.seller`, yoksa rakip adı. */
export function competitorSellerName(
  competitorName: string | null | undefined,
  matchAttributes: unknown,
): string | null {
  if (matchAttributes && typeof matchAttributes === "object" && !Array.isArray(matchAttributes)) {
    const seller = (matchAttributes as Record<string, unknown>).seller;
    if (typeof seller === "string" && seller.trim()) return seller.trim();
  }
  return competitorName?.trim() || null;
}

/**
 * Kullanıcının kendi mağazasını gösteren otomatik rakip satırı emekliye
 * ayrılmalı mı: aynı ilan satıcısı ya da skorlu (otomatik) bir satır, kullanıcı
 * onaylamamış, satıcı adı kendi mağazası ve henüz ölü işaretli değil.
 */
export function shouldRetireOwnStoreRow(
  row: { competitorName: string | null; matchScore: number | null; matchAttributes: unknown },
  ownStoreNames: readonly string[],
): boolean {
  const attrs =
    row.matchAttributes && typeof row.matchAttributes === "object"
      ? (row.matchAttributes as Record<string, unknown>)
      : {};
  if (attrs.review === "confirmed") return false;
  if (typeof attrs.deadAt === "string" && attrs.deadAt) return false;
  const automated = attrs.sameListing === true || row.matchScore !== null;
  if (!automated) return false;
  return isOwnStoreName(
    competitorSellerName(row.competitorName, row.matchAttributes),
    ownStoreNames,
  );
}

/**
 * `users.own_stores` JSON'u (`{"TRENDYOL": "Mağaza"}`): yalnız dolu metin
 * değerler alınır. Web aynası: `apps/web/src/lib/own-stores.ts`.
 */
export function parseOwnStores(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key.toUpperCase()] = value.trim();
  }
  return out;
}

/**
 * Bir pazaryerindeki kendi mağaza adları: o pazaryerine özel ad varsa yalnız o,
 * yoksa tüm pazaryerleri için girilmiş eski liste (`own_store_names`).
 */
export function ownStoreNamesFor(
  marketplace: string | null | undefined,
  ownStores: unknown,
  fallbackNames: readonly string[] | null | undefined,
): string[] {
  const specific = marketplace ? parseOwnStores(ownStores)[marketplace.toUpperCase()] : undefined;
  if (specific) return [specific];
  return [...(fallbackNames ?? [])];
}

/** Kullanıcının herhangi bir mağaza adı var mı (pazaryerine özel ya da genel). */
export function hasAnyOwnStore(
  ownStores: unknown,
  fallbackNames: readonly string[] | null | undefined,
): boolean {
  return Object.keys(parseOwnStores(ownStores)).length > 0 || (fallbackNames?.length ?? 0) > 0;
}
