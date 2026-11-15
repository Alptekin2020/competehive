// ============================================
// Google ürün kartı → satıcının gerçek ürün sayfası
// ============================================
//
// Google Alışveriş sonuçları satıcının sayfasına değil Google'ın ürün kartına
// bağlanır (canlı 2026-11-15: sonuçların tamamı). Kullanıcı rakibe tıklayınca
// Google açılıyordu ve fiyat yalnızca Google'ın bildirdiği kadar güncel
// kalıyordu. Satıcı, worker'ın tarayabildiği bir pazaryeriyse o sitede ürün
// sayfası aranır; güvenle eşleşen sayfa bulunursa rakibin bağlantısı o olur ve
// fiyat artık doğrudan satıcının sayfasından okunur.
//
// Bu dosya saf mantıktır (I/O yok): hangi kayıt aranır, hangi arama sonucu
// kabul edilir, durum matchAttributes içinde nasıl saklanır.

import {
  compareProductCodes,
  hasConflictingCountDescriptors,
  hasConflictingSpecs,
  isAccessoryListing,
  isPackagingListing,
  sharesStrongProductCode,
} from "./competitor-quality";
import {
  compareTitles,
  hasPackOrSpecConflict,
  isNearIdenticalTitle,
  isStrongTitleOverlap,
  urlSlugText,
} from "./title-similarity";

/** Ürün başına tur başına en fazla bu kadar gerçek sayfa araması (Serper kredisi). */
export const MAX_DIRECT_LOOKUPS_PER_ROUND = 3;

/** Sonuçsuz kalan arama bu kadar gün sonra yeniden denenir. */
export const DIRECT_LOOKUP_RETRY_DAYS = 7;

// Pazaryeri (Prisma enum) → ürün sayfası aranacak alan adı. Yalnızca worker'ın
// scraper'ı olan ve ürün sayfası kalıbı bilinen (isMarketplaceProductUrl)
// pazaryerleri: bulunan sayfa doğrudan taranabilmeli.
const MARKETPLACE_SITE_DOMAINS: Record<string, string> = {
  TRENDYOL: "trendyol.com",
  HEPSIBURADA: "hepsiburada.com",
  AMAZON_TR: "amazon.com.tr",
  N11: "n11.com",
  PAZARAMA: "pazarama.com",
  PTTAVM: "pttavm.com",
  TEKNOSA: "teknosa.com",
  VATAN: "vatanbilgisayar.com",
  MEDIAMARKT: "mediamarkt.com.tr",
};

export function siteDomainForMarketplace(marketplace: string): string | null {
  return MARKETPLACE_SITE_DOMAINS[marketplace] ?? null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Gerçek sayfaya taşınmış kaydın eski Google ürün kartı anahtarı (competitorUrlKey). */
export function readGoogleKey(matchAttributes: unknown): string | null {
  const value = asObject(matchAttributes).googleKey;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readDirectLookupAt(matchAttributes: unknown): Date | null {
  const value = asObject(matchAttributes).directLookupAt;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Arama denendiğini (ve bulunduysa eski Google anahtarını) mevcut alanları koruyarak yazar. */
export function withDirectLookup(
  matchAttributes: unknown,
  now: Date,
  googleKey?: string | null,
): Record<string, unknown> {
  return {
    ...asObject(matchAttributes),
    directLookupAt: now.toISOString(),
    ...(googleKey ? { googleKey } : {}),
  };
}

/** Bu kayıt için gerçek sayfa araması şimdi yapılmalı mı (daha önce denenmediyse ya da süresi dolduysa)? */
export function isDirectLookupDue(matchAttributes: unknown, now: Date): boolean {
  const last = readDirectLookupAt(matchAttributes);
  if (!last) return true;
  return now.getTime() - last.getTime() > DIRECT_LOOKUP_RETRY_DAYS * 24 * 60 * 60 * 1000;
}

export interface DirectListingCandidate {
  title: string;
  link: string;
}

/**
 * Arama sonuçlarından, rakibin gerçek ürün sayfası olduğundan emin olunan ilk
 * sonucu seçer. Kabul için: paket/ölçü çelişkisi yok (başlıkta ve URL yolunda),
 * aksesuar/ambalaj değil ve ya ürün kodu birebir aynı ya da başlık (kendi
 * ürünümüzle veya Google'daki rakip başlığıyla) deterministik olarak örtüşüyor.
 * Emin olunamazsa null — yanlış sayfaya bağlamaktansa Google bağlantısı kalır.
 */
export function pickDirectListing(
  ownTitle: string,
  competitorTitle: string,
  candidates: DirectListingCandidate[],
): DirectListingCandidate | null {
  for (const candidate of candidates) {
    const title = candidate.title?.trim();
    if (!title || !candidate.link) continue;
    if (isPackagingListing(title, ownTitle) || isAccessoryListing(title, ownTitle)) continue;
    if (hasPackOrSpecConflict(ownTitle, title)) continue;
    if (hasPackOrSpecConflict(ownTitle, urlSlugText(candidate.link))) continue;
    if (hasConflictingSpecs(ownTitle, title) || hasConflictingCountDescriptors(ownTitle, title)) {
      continue;
    }

    const codeRelation = compareProductCodes(ownTitle, title);
    if (codeRelation === "config-variant") continue;
    // Kısa model kodu (HD9650) tek başına yetmez: marka da ortak olmalı. Uzun
    // kod (MPN/barkod) çakışması neredeyse imkânsız olduğundan yeterlidir.
    const sameCode =
      (codeRelation === "exact" || codeRelation === "color-variant") &&
      (sharesStrongProductCode(ownTitle, title) || compareTitles(ownTitle, title).brandShared);
    const sameTitle =
      isNearIdenticalTitle(ownTitle, title) ||
      isStrongTitleOverlap(ownTitle, title) ||
      (competitorTitle.trim().length > 0 &&
        (isNearIdenticalTitle(competitorTitle, title) ||
          isStrongTitleOverlap(competitorTitle, title)));
    if (sameCode || sameTitle) return candidate;
  }
  return null;
}
