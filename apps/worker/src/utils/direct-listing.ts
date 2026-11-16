// ============================================
// Google ürün kartı → satıcının gerçek ürün sayfası
// ============================================
//
// Google Alışveriş sonuçları satıcının sayfasına değil Google'ın ürün kartına
// bağlanır (canlı 2026-11-15: sonuçların tamamı). Kullanıcı rakibe tıklayınca
// Google açılıyordu ve fiyat yalnızca Google'ın bildirdiği kadar güncel
// kalıyordu. Satıcı, worker'ın tarayabildiği bir pazaryeri ya da bilinen bir
// satıcı sitesiyse o sitede ürün sayfası aranır; güvenle eşleşen sayfa aday
// olarak saklanır, sayfanın gerçek başlığı doğrulanınca rakibin bağlantısı o
// olur ve fiyat artık doğrudan satıcının sayfasından okunur.
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
import { compareModelIdentity, isModelIdentityMismatch } from "./model-identity";
import {
  compareTitles,
  hasPackOrSpecConflict,
  isNearIdenticalTitle,
  isStrongTitleOverlap,
  urlSlugText,
} from "./title-similarity";
import { readCompetitorSeller } from "./match-review";
import { isGoogleHostedUrl } from "./stale-competitors";
import { competitorUrlKey, isSameListing } from "./url-match";

/** Ürün başına tur başına en fazla bu kadar gerçek sayfa araması (Serper kredisi). */
export const MAX_DIRECT_LOOKUPS_PER_ROUND = 3;

/** Sonuçsuz kalan arama bu kadar gün sonra yeniden denenir. */
export const DIRECT_LOOKUP_RETRY_DAYS = 7;

/**
 * Bayatlamış (72 saat+) kayıt da bu kadar gün daha aranabilir: Google kartı
 * görünmez olunca fiyat donar; gerçek sayfa bulunursa kayıt yeniden canlanır.
 */
export const DIRECT_LOOKUP_MAX_STALE_DAYS = 7;

/** Doğrulama bekleyen aday bu süreden eskiyse (iş kaybolduysa) yeni arama yapılabilir. */
export const DIRECT_CANDIDATE_TTL_HOURS = 24;

/** Reddedilen gerçek sayfa adayları (kayıt başına, en yenileri). */
export const MAX_DIRECT_REJECTED = 10;

/**
 * Doğrulama taraması geçici bir hatayla (429, zaman aşımı, 5xx) düştüyse aday
 * reddedilmez: bu kadar saat sonra yeniden önerilir. Aynı sayfa üst üste
 * MAX_DIRECT_TRANSIENT_FAILURES kez taranamazsa reddedilir.
 */
export const DIRECT_TRANSIENT_RETRY_HOURS = 24;
export const MAX_DIRECT_TRANSIENT_FAILURES = 3;

/** Kayıt başına saklanan Google ürün kartı anahtarı sayısı (en yenileri). */
export const MAX_GOOGLE_KEYS = 10;

/**
 * İlk iki kabul edilebilir aday farklı sayfalarsa ve puanları bu kadar
 * yakınsa hangisinin satıcının ilanı olduğu bilinemez → bağlanmaz.
 */
export const DIRECT_AMBIGUITY_MARGIN = 4;

/** Gerçek sayfaya taşınmış kayıt, Google kartı yeniden görülünce bu kadar saatte bir doğrudan taranır. */
export const ALIAS_DIRECT_REFRESH_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

// Pazaryeri enum'unda olan ama özel scraper'ı olmayan satıcı siteleri. Alan
// adları serper.ts RETAILER_DOMAINS ile aynı. Sayfaları bağımsız mağaza yoluyla
// (SSRF korumalı, Puppeteer'sız) taranır — bkz. scraperMarketplaceFor.
// AKAKCE/CIMRI/EPEY bilinçli olarak yok: fiyat karşılaştırma siteleri satıcı değildir.
const ENUM_SELLER_SITE_DOMAINS: Record<string, string> = {
  CICEKSEPETI: "ciceksepeti.com",
  BOYNER: "boyner.com.tr",
  KOCTAS: "koctas.com.tr",
  KITAPYURDU: "kitapyurdu.com",
  ITOPYA: "itopya.com",
  GRATIS: "gratis.com",
  WATSONS: "watsons.com.tr",
  SEPHORA: "sephora.com.tr",
};

// Enum dışındaki (CUSTOM) satıcılar: Google kartının `source` alanındaki
// satıcı adı (katlanmış: küçük harf, Türkçe karaktersiz, noktalama boşluk).
export const SELLER_SITE_DOMAINS: Array<{ domain: string; names: string[] }> = [
  { domain: "idefix.com", names: ["idefix"] },
  { domain: "dr.com.tr", names: ["d r", "dr", "d r kultur"] },
  { domain: "evkur.com.tr", names: ["evkur"] },
  { domain: "koctas.com.tr", names: ["koctas"] },
  { domain: "boyner.com.tr", names: ["boyner"] },
  { domain: "ciceksepeti.com", names: ["ciceksepeti", "cicek sepeti"] },
  { domain: "kitapyurdu.com", names: ["kitapyurdu"] },
  { domain: "itopya.com", names: ["itopya"] },
  { domain: "gratis.com", names: ["gratis"] },
  { domain: "watsons.com.tr", names: ["watsons"] },
  { domain: "sephora.com.tr", names: ["sephora"] },
  { domain: "karaca.com", names: ["karaca"] },
  { domain: "englishhome.com", names: ["english home"] },
  { domain: "arcelik.com.tr", names: ["arcelik"] },
  { domain: "beko.com.tr", names: ["beko"] },
  { domain: "vestel.com.tr", names: ["vestel"] },
];

/** Fiyat karşılaştırma siteleri: satıcı değildir, ürün sayfası olarak asla kabul edilmez. */
export const PRICE_COMPARISON_DOMAINS = ["akakce.com", "cimri.com", "epey.com"] as const;

export interface SellerSite {
  domain: string;
  /** marketplace: ürün sayfası kalıbı bilinir; store: genel ürün sayfası sezgisi. */
  kind: "marketplace" | "store";
}

export function siteDomainForMarketplace(marketplace: string): string | null {
  return MARKETPLACE_SITE_DOMAINS[marketplace] ?? null;
}

function fold(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

function foldWords(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

/**
 * Kaydın gerçek ürün sayfası hangi sitede aranır? Önce pazaryeri enum'u
 * (scraper'lı pazaryeri ya da enum'daki satıcı sitesi), sonra Google kartının
 * satıcı adı. Fiyat karşılaştırma siteleri ve bilinmeyen satıcılar → null.
 */
export function sellerSiteDomain(
  marketplace: string,
  sellerName: string | null | undefined,
): SellerSite | null {
  const marketplaceDomain = MARKETPLACE_SITE_DOMAINS[marketplace];
  if (marketplaceDomain) return { domain: marketplaceDomain, kind: "marketplace" };
  const enumDomain = ENUM_SELLER_SITE_DOMAINS[marketplace];
  if (enumDomain) return { domain: enumDomain, kind: "store" };
  if (!sellerName) return null;
  const folded = foldWords(sellerName);
  if (!folded) return null;
  if (PRICE_COMPARISON_DOMAINS.some((d) => folded.includes(d.split(".")[0]))) return null;
  // "Trendyol" gibi pazaryeri adı CUSTOM kayıtta da yakalanır.
  for (const domain of Object.values(MARKETPLACE_SITE_DOMAINS)) {
    if (folded.includes(domain)) return { domain, kind: "marketplace" };
  }
  const words = folded.replace(/\./g, " ").replace(/\s+/g, " ").trim();
  for (const entry of SELLER_SITE_DOMAINS) {
    if (folded.includes(entry.domain)) return { domain: entry.domain, kind: "store" };
    for (const name of entry.names) {
      if (words === name || words.startsWith(`${name} `) || words === `${name} com`) {
        return { domain: entry.domain, kind: "store" };
      }
    }
  }
  return null;
}

/**
 * Teşhis: gerçek sayfası hiçbir sitede aranamayan Google kartlarının satıcı
 * adları (sayısıyla, çoktan aza). SELLER_SITE_DOMAINS'e eklenecek satıcılar
 * buradan görülür; "Satıcı bilinmiyor" kartlar "(bilinmiyor)" olarak sayılır.
 */
export function unlinkableGoogleSellers(
  competitors: Array<{
    competitorUrl?: string | null;
    marketplace: string;
    matchAttributes?: unknown;
  }>,
  limit = 5,
): Array<{ seller: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of competitors) {
    if (!isGoogleHostedUrl(c.competitorUrl)) continue;
    const seller = readCompetitorSeller(c.matchAttributes);
    if (sellerSiteDomain(c.marketplace, seller)) continue;
    const key = seller?.trim() || "(bilinmiyor)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([seller, count]) => ({ seller, count }))
    .sort((a, b) => b.count - a.count || a.seller.localeCompare(b.seller))
    .slice(0, limit);
}

/**
 * Bu pazaryerinin kaydı hangi scraper ile taranır? Özel scraper'ı olanlar
 * kendi adıyla; diğer her şey (enum'daki satıcı siteleri dahil) bağımsız mağaza
 * yolu ("CUSTOM"): her yönlendirmede SSRF denetimi, Puppeteer yok.
 */
const DEDICATED_SCRAPER_MARKETPLACES = new Set([
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
  "PAZARAMA",
  "PTTAVM",
  "TEKNOSA",
  "VATAN",
  "MEDIAMARKT",
  "DECATHLON",
  "SHOPIFY",
]);

export function scraperMarketplaceFor(marketplace: string): string {
  return DEDICATED_SCRAPER_MARKETPLACES.has(marketplace) ? marketplace : "CUSTOM";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ============================================
// matchAttributes durumu
// ============================================

/**
 * Gerçek sayfaya taşınmış kaydın Google ürün kartı anahtarları
 * (competitorUrlKey). Eski tekil `googleKey` alanı okunurken diziye katılır.
 */
export function readGoogleKeys(matchAttributes: unknown): string[] {
  const attrs = asObject(matchAttributes);
  const out: string[] = [];
  const raw = attrs.googleKeys;
  if (Array.isArray(raw)) {
    for (const v of raw) if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  const legacy = attrs.googleKey;
  if (typeof legacy === "string" && legacy.length > 0 && !out.includes(legacy)) out.push(legacy);
  return out;
}

/** Anahtarları mevcut dizinin sonuna ekler (tekrarsız, en yeni MAX_GOOGLE_KEYS); eski alanı kaldırır. */
export function withGoogleKeys(
  matchAttributes: unknown,
  keys: ReadonlyArray<string | null | undefined>,
): Record<string, unknown> {
  const merged = readGoogleKeys(matchAttributes);
  for (const k of keys) {
    if (!k) continue;
    const idx = merged.indexOf(k);
    if (idx >= 0) merged.splice(idx, 1);
    merged.push(k);
  }
  const rest = { ...asObject(matchAttributes) };
  delete rest.googleKey;
  return merged.length > 0 ? { ...rest, googleKeys: merged.slice(-MAX_GOOGLE_KEYS) } : rest;
}

export function readDirectLookupAt(matchAttributes: unknown): Date | null {
  const value = asObject(matchAttributes).directLookupAt;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Eşleştirme kurallarının sürümü. Kurallar yanlış retleri düzeltecek şekilde
 * değiştiğinde artırılır: eski sürümle aranmış kayıtlar 7 günü beklemeden
 * yeniden aranır ve eski kurallarla verilmiş retler (directRejected,
 * directTransient) yok sayılır (prod 16 Kasım: "Air Fryer" ↔ "Airfryer" ve
 * "Renkli" ↔ "Kapasiteli" yüzünden doğru sayfalar reddedilmişti).
 */
export const DIRECT_RULES_VERSION = 2;

export function readDirectRulesVersion(matchAttributes: unknown): number {
  const value = asObject(matchAttributes).directRulesV;
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

/** Arama denendiğini mevcut alanları koruyarak yazar (kural sürümüyle). */
export function withDirectLookup(matchAttributes: unknown, now: Date): Record<string, unknown> {
  const rest = { ...asObject(matchAttributes) };
  if (readDirectRulesVersion(matchAttributes) < DIRECT_RULES_VERSION) {
    delete rest.directRejected;
    delete rest.directTransient;
  }
  return { ...rest, directLookupAt: now.toISOString(), directRulesV: DIRECT_RULES_VERSION };
}

export interface DirectCandidate {
  url: string;
  at: string;
}

export function readDirectCandidate(matchAttributes: unknown): DirectCandidate | null {
  const value = asObject(asObject(matchAttributes).directCandidate);
  return typeof value.url === "string" && typeof value.at === "string"
    ? { url: value.url, at: value.at }
    : null;
}

/** Doğrulanacak gerçek sayfa adayını yazar (bağlantı henüz değişmez). */
export function withDirectCandidate(
  matchAttributes: unknown,
  url: string,
  now: Date,
): Record<string, unknown> {
  return {
    ...withDirectLookup(matchAttributes, now),
    directCandidate: { url, at: now.toISOString() },
  };
}

export function withoutDirectCandidate(matchAttributes: unknown): Record<string, unknown> {
  const rest = { ...asObject(matchAttributes) };
  delete rest.directCandidate;
  return rest;
}

/** Doğrulamada reddedilen sayfaların anahtarları (competitorUrlKey). */
export function readDirectRejected(matchAttributes: unknown): string[] {
  // Eski kural sürümüyle verilmiş retler geçersizdir.
  if (readDirectRulesVersion(matchAttributes) < DIRECT_RULES_VERSION) return [];
  const raw = asObject(matchAttributes).directRejected;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** Adayı reddedilenlere ekler (en yeni MAX_DIRECT_REJECTED) ve bekleyen adayı kaldırır. */
export function withDirectRejected(matchAttributes: unknown, url: string): Record<string, unknown> {
  const key = competitorUrlKey(url);
  const list = readDirectRejected(matchAttributes).filter((k) => k !== key);
  list.push(key);
  return {
    ...withoutDirectCandidate(matchAttributes),
    directRejected: list.slice(-MAX_DIRECT_REJECTED),
    directRulesV: DIRECT_RULES_VERSION,
  };
}

interface DirectTransient {
  key: string;
  count: number;
  retryAt: string;
}

function readDirectTransient(matchAttributes: unknown): DirectTransient | null {
  const value = asObject(asObject(matchAttributes).directTransient);
  return typeof value.key === "string" &&
    typeof value.count === "number" &&
    typeof value.retryAt === "string"
    ? { key: value.key, count: value.count, retryAt: value.retryAt }
    : null;
}

/**
 * Doğrulama taraması geçici hatayla düştü (Boyner 429 gibi). Aday kalıcı
 * reddedilmez: bekleyen aday kaldırılır, DIRECT_TRANSIENT_RETRY_HOURS sonra
 * arama yeniden yapılır. Aynı sayfa MAX_DIRECT_TRANSIENT_FAILURES kez üst üste
 * taranamazsa directRejected'a yazılır.
 */
export function withDirectTransientFailure(
  matchAttributes: unknown,
  url: string,
  now: Date,
): { attributes: Record<string, unknown>; rejected: boolean; failures: number } {
  const key = competitorUrlKey(url);
  const previous = readDirectTransient(matchAttributes);
  const failures = previous && previous.key === key ? previous.count + 1 : 1;
  if (failures >= MAX_DIRECT_TRANSIENT_FAILURES) {
    const rest = withDirectRejected(matchAttributes, url);
    delete rest.directTransient;
    return { attributes: rest, rejected: true, failures };
  }
  const retryAt = new Date(now.getTime() + DIRECT_TRANSIENT_RETRY_HOURS * HOUR_MS);
  return {
    attributes: {
      ...withoutDirectCandidate(matchAttributes),
      directTransient: { key, count: failures, retryAt: retryAt.toISOString() },
    },
    rejected: false,
    failures,
  };
}

/** Bu kayıt için gerçek sayfa araması şimdi yapılmalı mı? */
export function isDirectLookupDue(matchAttributes: unknown, now: Date): boolean {
  const candidate = readDirectCandidate(matchAttributes);
  if (candidate) {
    const at = new Date(candidate.at).getTime();
    if (Number.isFinite(at) && now.getTime() - at < DIRECT_CANDIDATE_TTL_HOURS * HOUR_MS) {
      return false;
    }
  }
  const last = readDirectLookupAt(matchAttributes);
  if (!last) return true;
  if (candidate) return true;
  // Kurallar değişti: eski sürümle aranmış kayıt hemen yeniden aranır.
  if (readDirectRulesVersion(matchAttributes) < DIRECT_RULES_VERSION) return true; // aday süresi doldu: doğrulama işi kayboldu
  const transient = readDirectTransient(matchAttributes);
  if (transient) {
    const retryAt = new Date(transient.retryAt).getTime();
    // Yalnızca hatadan sonra henüz yeniden aranmadıysa (aksi halde her tur aranırdı).
    if (Number.isFinite(retryAt) && now.getTime() >= retryAt && last.getTime() < retryAt) {
      return true;
    }
  }
  return now.getTime() - last.getTime() > DIRECT_LOOKUP_RETRY_DAYS * DAY_MS;
}

/**
 * Fiyat tazeliği yeterli mi? Güncel kayıtlar ve en fazla
 * DIRECT_LOOKUP_MAX_STALE_DAYS gün önce bayatlamış kayıtlar aranır.
 */
export function isFreshEnoughForLookup(
  lastScrapedAt: Date | null,
  now: Date,
  staleHours: number,
): boolean {
  if (!lastScrapedAt) return false;
  const cutoff = now.getTime() - staleHours * HOUR_MS - DIRECT_LOOKUP_MAX_STALE_DAYS * DAY_MS;
  return lastScrapedAt.getTime() >= cutoff;
}

// ============================================
// Aday puanlama
// ============================================

export interface DirectListingCandidate {
  title: string;
  link: string;
}

// Paket/hediye/kombin sözcükleri: kaynakta yoksa aday başka bir üründür
// (prod 16 Kasım: "HD9650/90 Airfryer Ekmek Kızartma Hediyeli" kod + marka
// ile kabul edildi).
const BUNDLE_WORDS = [
  "hediyeli",
  "hediye",
  "hediyesi",
  "set",
  "seti",
  "paket",
  "paketi",
  "kombin",
  "kombini",
  "bundle",
  "yaninda",
];

// Ana ürüne eklenmiş BAŞKA ürün ifadeleri.
const EXTRA_PRODUCT_PHRASES = [
  "ekmek kizartma",
  "tost makinesi",
  "kahve degirmeni",
  "su isiticisi",
  "kettle",
  "blender",
  "dograyici",
  "mikser",
  "sac kurutma",
  "yedek basli",
];

const COLOUR_WORDS: Record<string, string> = {
  siyah: "siyah",
  black: "siyah",
  beyaz: "beyaz",
  white: "beyaz",
  kirmizi: "kirmizi",
  red: "kirmizi",
  mavi: "mavi",
  blue: "mavi",
  lacivert: "lacivert",
  yesil: "yesil",
  green: "yesil",
  sari: "sari",
  turuncu: "turuncu",
  mor: "mor",
  lila: "lila",
  pembe: "pembe",
  pink: "pembe",
  gri: "gri",
  grey: "gri",
  gray: "gri",
  fume: "fume",
  antrasit: "antrasit",
  kahverengi: "kahverengi",
  bej: "bej",
  altin: "altin",
  gold: "altin",
  gumus: "gumus",
  silver: "gumus",
  bronz: "bronz",
  bordo: "bordo",
  turkuaz: "turkuaz",
};

function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${words(text).join(" ")} `.includes(` ${phrase} `);
}

/** Adayda kaynakta olmayan paket/hediye/ek ürün ifadesi var mı? */
export function hasBundleSignal(sourceText: string, candidateText: string): boolean {
  for (const w of BUNDLE_WORDS) {
    if (hasPhrase(candidateText, w) && !hasPhrase(sourceText, w)) return true;
  }
  for (const p of EXTRA_PRODUCT_PHRASES) {
    if (hasPhrase(candidateText, p) && !hasPhrase(sourceText, p)) return true;
  }
  // "Vitality Pro Clean + Kids": artı işareti iki ürünü birleştirir.
  return /\s\+\s|\+\s*\d/.test(candidateText) && !/\+/.test(sourceText);
}

export function colours(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    const c = COLOUR_WORDS[w];
    if (c) out.add(c);
  }
  return out;
}

/** İki metin de renk yazıyor ve ortak renk yok: "Lila" ↔ "Siyah". */
export function hasColourConflict(sourceText: string, candidateText: string): boolean {
  const a = colours(sourceText);
  const b = colours(candidateText);
  if (a.size === 0 || b.size === 0) return false;
  for (const c of a) if (b.has(c)) return false;
  return true;
}

// Aroma/koku/çeşit sıfatları ("Çilekli", "Fıstıklı"): ikisinde de farklı biri
// varsa aynı kod/marka altında farklı çeşittir. Ortak "-li" sözcükler ve renk
// sözcükleri sayılmaz.
// Çeşit bildirmeyen genel "-li/-lu" sözcükler ("Bakır Renkli", "4 Fincan
// Kapasiteli"): bunlar yer değiştirse de aynı üründür (prod 16 Kasım: Vatan'daki
// Arzum OK004 sayfası "renkli" ↔ "kapasiteli" yüzünden reddedildi).
const GENERIC_DESCRIPTOR_WORDS = new Set([
  "renkli",
  "kapasiteli",
  "ozellikli",
  "fonksiyonlu",
  "sistemli",
  "garantili",
  "faturali",
  "kutulu",
  "teknolojili",
  "tasarimli",
  "modelli",
  "ayarli",
  "kademeli",
  "gostergeli",
  "ekranli",
]);

function descriptorWords(text: string): Set<string> {
  return new Set(
    words(text).filter(
      (w) => w.length >= 5 && /(li|lu)$/.test(w) && !GENERIC_DESCRIPTOR_WORDS.has(w),
    ),
  );
}

export function hasSwappedDescriptor(sourceText: string, candidateText: string): boolean {
  const a = descriptorWords(sourceText);
  const b = descriptorWords(candidateText);
  const onlyA = [...a].filter((w) => !b.has(w));
  const onlyB = [...b].filter((w) => !a.has(w));
  return onlyA.length > 0 && onlyB.length > 0;
}

/**
 * Kesin ret nedeni (null: ret yok). Puanlamadan ÖNCE çalışır; tek bir sinyal
 * adayı eler. Yeni deterministik ret denetimleri (ör. model kodu çelişkisi)
 * bu fonksiyona eklenir.
 */
export function directListingRejectReason(
  ownTitle: string,
  competitorTitle: string,
  candidate: DirectListingCandidate,
): string | null {
  const title = candidate.title;
  const slug = urlSlugText(candidate.link);
  if (isPackagingListing(title, ownTitle) || isAccessoryListing(title, ownTitle)) {
    return "accessory-or-packaging";
  }
  if (hasPackOrSpecConflict(ownTitle, title) || hasPackOrSpecConflict(ownTitle, slug)) {
    return "pack-or-spec";
  }
  if (hasConflictingSpecs(ownTitle, title) || hasConflictingCountDescriptors(ownTitle, title)) {
    return "spec";
  }
  if (hasBundleSignal(ownTitle, title) || hasBundleSignal(ownTitle, slug)) return "bundle";
  // Renk: kaynak renk yazmıyorsa Google kartının rengi esas alınır.
  const colourSource = colours(ownTitle).size > 0 ? ownTitle : competitorTitle;
  if (hasColourConflict(colourSource, title) || hasColourConflict(colourSource, slug)) {
    return "colour";
  }
  const codeRelation = compareProductCodes(ownTitle, title);
  if (codeRelation === "config-variant") return "config-variant";
  // Model kodu aynı ama renk eki farklı (EP3347/90 ↔ EP3347/50): başka renk.
  if (codeRelation === "color-variant") return "colour-code";
  if (hasSwappedDescriptor(ownTitle, title)) return "swapped-descriptor";
  return null;
}

export interface ScoredDirectCandidate {
  candidate: DirectListingCandidate;
  score: number;
  via: "code" | "near-identical" | "overlap";
}

/**
 * Tek adayın puanı (null: kabul edilemez). Kanıt her zaman KENDİ ürünümüzün
 * başlığına karşıdır; Google kartı başlığı yalnızca eşit puanları ayırır
 * (prod: "Doctamin icollagen İyi Uykular" Google başlığıyla örtüştüğü için
 * "icollagen 5 Tip Kolajen" ürününe bağlandı).
 */
export function scoreDirectCandidate(
  ownTitle: string,
  competitorTitle: string,
  candidate: DirectListingCandidate,
): ScoredDirectCandidate | null {
  const title = candidate.title?.trim();
  if (!title || !candidate.link) return null;
  const normalized = { title, link: candidate.link };
  if (directListingRejectReason(ownTitle, competitorTitle, normalized)) return null;

  const sim = compareTitles(ownTitle, title);
  const coverage = 5 * sim.sourceCoverage + 5 * sim.candidateCoverage;
  const cardBonus =
    competitorTitle.trim().length > 0 &&
    (isNearIdenticalTitle(competitorTitle, title) || isStrongTitleOverlap(competitorTitle, title))
      ? 2
      : 0;

  // Kısa model kodu (HD9650) tek başına yetmez: marka da ortak olmalı. Uzun
  // kod (MPN/barkod) çakışması neredeyse imkânsız olduğundan yeterlidir.
  // Kod yolunda da varyant sözcüğü (Pro/Kids/Set…) kabulü engeller.
  const sameCode =
    compareProductCodes(ownTitle, title) === "exact" &&
    (sharesStrongProductCode(ownTitle, title) || sim.brandShared) &&
    !sim.hasVariantExtra;
  if (sameCode) return { candidate: normalized, score: 90 + coverage + cardBonus, via: "code" };
  if (isNearIdenticalTitle(ownTitle, title)) {
    return { candidate: normalized, score: 85 + coverage + cardBonus, via: "near-identical" };
  }
  if (isStrongTitleOverlap(ownTitle, title)) {
    return { candidate: normalized, score: 75 + coverage + cardBonus, via: "overlap" };
  }
  return null;
}

function samePage(a: string, b: string): boolean {
  return competitorUrlKey(a) === competitorUrlKey(b) || isSameListing(a, b);
}

/**
 * Arama sonuçlarının HEPSİNİ puanlar ve en iyisini seçer. İlk ikisi farklı
 * sayfalar ve puanları DIRECT_AMBIGUITY_MARGIN içindeyse hangisinin satıcının
 * ilanı olduğu bilinemez → null. Emin olunamazsa null — yanlış sayfaya
 * bağlamaktansa Google bağlantısı kalır.
 */
export function pickDirectListing(
  ownTitle: string,
  competitorTitle: string,
  candidates: DirectListingCandidate[],
  ownUrl?: string | null,
): DirectListingCandidate | null {
  const scored = candidates
    // Model kimliği (başlık + URL slug'ı): farklı kod/numara/boyut ya da
    // kaynaktaki kodu doğrulamayan sayfa asla bağlanmaz.
    .filter((c) => {
      if (!c.title?.trim() || !c.link) return false;
      const identity = compareModelIdentity(
        { title: ownTitle, url: ownUrl },
        { title: c.title, url: c.link },
      );
      return !isModelIdentityMismatch(identity) && identity !== "unknown";
    })
    .map((c) => scoreDirectCandidate(ownTitle, competitorTitle, c))
    .filter((s): s is ScoredDirectCandidate => s !== null)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const [best, ...rest] = scored;
  const rival = rest.find((s) => !samePage(s.candidate.link, best.candidate.link));
  if (rival && best.score - rival.score < DIRECT_AMBIGUITY_MARGIN) return null;
  return best.candidate;
}

/**
 * Doğrulama: taranan sayfanın GERÇEK başlığı kendi ürünümüzle aynı kurallardan
 * geçiyor mu? (arama sonucu başlığı kısaltılmış olabilir.)
 */
export function verifyDirectPage(
  ownTitle: string,
  competitorTitle: string,
  pageTitle: string | null | undefined,
  url: string,
): boolean {
  if (!pageTitle || pageTitle.trim().length < 3) return false;
  if (hasPackOrSpecConflict(ownTitle, pageTitle)) return false;
  const identity = compareModelIdentity({ title: ownTitle }, { title: pageTitle, url });
  if (isModelIdentityMismatch(identity)) return false;
  return scoreDirectCandidate(ownTitle, competitorTitle, { title: pageTitle, link: url }) !== null;
}

// ============================================
// Birleştirme ve takma anahtar (alias) kararları
// ============================================

/** Satıcı adları aynı satıcıyı mı gösteriyor? (biri bilinmiyorsa true) */
export function sameSeller(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const fa = foldWords(a).replace(/[ .]/g, "");
  const fb = foldWords(b).replace(/[ .]/g, "");
  if (!fa || !fb) return true;
  return fa === fb || fa.startsWith(fb) || fb.startsWith(fa);
}

export type DirectMergeDecision =
  | "merge"
  | "skip-confirmed"
  | "skip-different-seller"
  | "skip-untrusted-existing";

/**
 * Bulunan sayfa zaten ayrı bir rakipse Google satırı silinip o satıra
 * birleştirilir mi? Kullanıcının onayladığı satır, farklı satıcının satırı ve
 * güvenilmez (onay bekleyen / düşük skorlu) bir satıra birleştirme yapılmaz:
 * aksi halde gerçek bir rakip kaybolur.
 */
export function decideDirectMerge(input: {
  targetConfirmed: boolean;
  targetSeller: string | null;
  existingSeller: string | null;
  existingTrusted: boolean;
}): DirectMergeDecision {
  if (input.targetConfirmed) return "skip-confirmed";
  if (!input.existingTrusted) return "skip-untrusted-existing";
  if (!sameSeller(input.targetSeller, input.existingSeller)) return "skip-different-seller";
  return "merge";
}

/**
 * Bir Google sonucuyla eşleşen kayıtları ayırır: bağlantısı hâlâ o Google kartı
 * olanlar (fiyat/ad sonuçtan yazılır) ve kartı yalnızca takma anahtarla tanınan,
 * gerçek sayfaya taşınmış kayıtlar (fiyatı/adı sayfadan okunur; Google'ın
 * değeri yazılmaz — iki kaynak birbirini ezip sahte fiyat hareketi üretiyordu).
 */
export function partitionAliasHits<T extends { competitorUrl: string }>(
  rows: T[],
  resultKey: string,
): { direct: T[]; viaGoogle: T[] } {
  const direct: T[] = [];
  const viaGoogle: T[] = [];
  for (const row of rows) {
    if (competitorUrlKey(row.competitorUrl) === resultKey) viaGoogle.push(row);
    else direct.push(row);
  }
  return { direct, viaGoogle };
}

/** Takma anahtarla görülen gerçek sayfa kaydı doğrudan taranmalı mı? */
export function needsAliasDirectRefresh(lastScrapedAt: Date | null, now: Date): boolean {
  if (!lastScrapedAt) return true;
  return now.getTime() - lastScrapedAt.getTime() >= ALIAS_DIRECT_REFRESH_HOURS * HOUR_MS;
}
