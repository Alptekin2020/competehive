import { getCachedSerperResults, setCachedSerperResults } from "./utils/cache";
import { directFetch, isTransientStatus, withRetry } from "./utils/direct-fetch";

export interface SerperShoppingResult {
  title: string;
  // Satıcı/mağaza adı ("Trendyol", "Hepsiburada", "Evkur"…). Bağlantı Google
  // Alışveriş sayfasına gidiyorsa gerçek siteyi yalnızca bu alan söyler
  // (bkz. resolveRetailer). Web araması sonuçlarında "web" sabitidir.
  source: string;
  link: string; // doğrudan satıcı bağlantısıysa retailer buradan parse edilir
  price: string; // "₺1.299,00" formatında
  imageUrl?: string;
  position: number;
  /** Web araması sonucunun özet metni (barkod taşıyabilir; bkz. listing-identity). */
  snippet?: string;
}

export interface Retailer {
  name: string;
  color: string;
}

// ============================================
// Retailer Domain Map
// ============================================
// Worker'ın Docker build context'i sadece apps/worker/ olduğu için
// @competehive/shared paketini import edemiyoruz. Bu liste packages/shared/src/index.ts
// içindeki MARKETPLACES ile aynı tutulmalı. (Audit P1-4)
const RETAILER_DOMAINS: Array<{ domain: string; name: string; color: string }> = [
  { domain: "trendyol.com", name: "Trendyol", color: "#F27A1A" },
  { domain: "hepsiburada.com", name: "Hepsiburada", color: "#FF6000" },
  { domain: "amazon.com.tr", name: "Amazon TR", color: "#FF9900" },
  { domain: "n11.com", name: "N11", color: "#6F3FAB" },
  { domain: "pazarama.com", name: "Pazarama", color: "#00C4B3" },
  { domain: "mediamarkt.com.tr", name: "MediaMarkt", color: "#DF0000" },
  { domain: "teknosa.com", name: "Teknosa", color: "#005CA9" },
  { domain: "vatanbilgisayar.com", name: "Vatan", color: "#E30613" },
  { domain: "decathlon.com.tr", name: "Decathlon", color: "#0082C3" },
  { domain: "pttavm.com", name: "PTT AVM", color: "#FFD600" },
  { domain: "ciceksepeti.com", name: "Çiçeksepeti", color: "#E91E63" },
  { domain: "akakce.com", name: "Akakçe", color: "#00BCD4" },
  { domain: "cimri.com", name: "Cimri", color: "#4CAF50" },
  { domain: "epey.com", name: "Epey", color: "#2196F3" },
  { domain: "boyner.com.tr", name: "Boyner", color: "#1A1A1A" },
  { domain: "watsons.com.tr", name: "Watsons", color: "#00A19A" },
  { domain: "kitapyurdu.com", name: "Kitapyurdu", color: "#FF5722" },
  { domain: "sephora.com.tr", name: "Sephora", color: "#000000" },
  { domain: "koctas.com.tr", name: "Koçtaş", color: "#FF6F00" },
  { domain: "itopya.com", name: "İtopya", color: "#00C853" },
  // Gratis domain'i yanlış set'lenmiş olabilir — shared'de "grfratis" var.
  // Hem doğru hem yanlış varyantı kapsa.
  { domain: "gratis.com", name: "Gratis", color: "#FF4081" },
  { domain: "grfratis.com", name: "Gratis", color: "#FF4081" },
];

export function extractRetailer(link: string): Retailer {
  const lower = link.toLowerCase();
  for (const r of RETAILER_DOMAINS) {
    if (lower.includes(r.domain)) {
      return { name: r.name, color: r.color };
    }
  }
  return { name: "Diğer", color: "#6B7280" };
}

// ============================================
// Google Alışveriş bağlantıları → gerçek satıcı
// ============================================
//
// Google Shopping sonuçlarının bir kısmı satıcının sayfasına değil Google'ın
// kendi ürün kartına bağlanır ("google.com/search?ibp=oshop&…&prds=…"). Bu
// bağlantıdan alan adı okununca rakip "google.com" olarak görünüyordu; oysa
// fiyatı veren gerçek satıcı sonucun `source` alanındadır.

/** Bağlantı Google'ın kendi sayfasına mı gidiyor (satıcının sitesine değil)? */
export function isGoogleHostedLink(link: string | null | undefined): boolean {
  if (typeof link !== "string" || link.length === 0) return false;
  try {
    const host = new URL(link).hostname.toLowerCase();
    return /(^|\.)google\.[a-z.]+$/.test(host);
  } catch {
    return false;
  }
}

function foldRetailerText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

const SOURCE_PLACEHOLDER_RE = /^(google(\.com)?|google shopping|google alisveris|web|diger)?$/;

/**
 * Sonucun `source` alanındaki satıcı adını temizler. Boş, "google.com" ya da
 * web araması sabiti ("web") gerçek bir satıcı değildir → null.
 */
export function cleanSellerSource(source: string | null | undefined): string | null {
  if (typeof source !== "string") return null;
  const trimmed = source.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (SOURCE_PLACEHOLDER_RE.test(foldRetailerText(trimmed))) return null;
  return trimmed;
}

/** Satıcı adı bilinen bir pazaryerine mi ait? ("Amazon.com.tr - Satıcı" → Amazon TR) */
export function retailerFromSourceName(source: string | null | undefined): Retailer | null {
  const cleaned = cleanSellerSource(source);
  if (!cleaned) return null;
  const folded = foldRetailerText(cleaned);
  const compact = folded.replace(/[ .]/g, "");
  for (const r of RETAILER_DOMAINS) {
    const nameFolded = foldRetailerText(r.name);
    const nameCompact = nameFolded.replace(/[ .]/g, "");
    // "Amazon TR" sonuçlarda "Amazon.com.tr" / "Amazon Türkiye" olarak gelir.
    const brandCompact = r.domain.split(".")[0];
    if (
      folded.includes(r.domain) ||
      folded === nameFolded ||
      folded.startsWith(`${nameFolded} `) ||
      compact === nameCompact ||
      (nameCompact.length >= 6 && compact.startsWith(nameCompact)) ||
      (brandCompact.length >= 6 && compact.startsWith(brandCompact))
    ) {
      return { name: r.name, color: r.color };
    }
  }
  return null;
}

export interface ResolvedRetailer extends Retailer {
  /** Bağlantı Google'ın ürün kartına gidiyor; satıcı sayfası değil, taranamaz. */
  viaGoogle: boolean;
  /** Google bağlantısının ardındaki gerçek satıcı adı (bilinmiyorsa null). */
  sellerName: string | null;
}

/**
 * Bir arama sonucunun gerçek satıcısını çözer. Doğrudan satıcı bağlantısında
 * alan adı esastır; Google'a giden bağlantıda `source` alanı kullanılır.
 */
export function resolveRetailer(result: {
  link: string;
  source?: string | null;
}): ResolvedRetailer {
  const viaGoogle = isGoogleHostedLink(result.link);
  if (!viaGoogle) {
    const byLink = extractRetailer(result.link);
    return { ...byLink, viaGoogle: false, sellerName: null };
  }
  const bySource = retailerFromSourceName(result.source);
  if (bySource) return { ...bySource, viaGoogle: true, sellerName: bySource.name };
  return {
    name: "Diğer",
    color: "#6B7280",
    viaGoogle: true,
    sellerName: cleanSellerSource(result.source),
  };
}

const RETAILER_MARKETPLACE_KEYS: Record<string, string> = {
  Trendyol: "TRENDYOL",
  Hepsiburada: "HEPSIBURADA",
  "Amazon TR": "AMAZON_TR",
  N11: "N11",
  Pazarama: "PAZARAMA",
  MediaMarkt: "MEDIAMARKT",
  Teknosa: "TEKNOSA",
  Vatan: "VATAN",
  Decathlon: "DECATHLON",
  "PTT AVM": "PTTAVM",
  Çiçeksepeti: "CICEKSEPETI",
  Akakçe: "AKAKCE",
  Cimri: "CIMRI",
  Epey: "EPEY",
  Boyner: "BOYNER",
  Watsons: "WATSONS",
  Kitapyurdu: "KITAPYURDU",
  Sephora: "SEPHORA",
  Koçtaş: "KOCTAS",
  İtopya: "ITOPYA",
  Gratis: "GRATIS",
};

/** Satıcı görünen adı → Prisma Marketplace enum anahtarı (bilinmiyorsa null). */
export function marketplaceKeyForRetailer(retailerName: string): string | null {
  return RETAILER_MARKETPLACE_KEYS[retailerName] ?? null;
}

// Marketplace adı → scraper'lı destek var mı (puppeteer fallback'i için kullanılabilir mi)
const SCRAPER_BACKED_RETAILERS = new Set([
  "Trendyol",
  "Hepsiburada",
  "Amazon TR",
  "N11",
  "Pazarama",
  "Teknosa",
  "Vatan",
  "Decathlon",
  "MediaMarkt",
  "PTT AVM",
]);

export function isScraperBackedRetailer(retailerName: string): boolean {
  return SCRAPER_BACKED_RETAILERS.has(retailerName);
}

// ============================================
// Price Parsing (Audit P2-5)
// ============================================
// Serper sometimes returns prices with prefixes ("İndirimde: ₺99,99"),
// ranges ("₺1.290 - ₺1.890"), or marketing text ("8 ay 99 TL'den başlayan").
// We extract the FIRST plausible numeric block and parse it as Turkish-format
// when possible, falling back to en-US format.
export function parsePrice(priceStr: string): number | null {
  if (!priceStr || typeof priceStr !== "string") return null;

  // Turkish-aware numeric extraction (Audit P2-5 + Gemini review).
  // Priority 1: numeric block adjacent to currency marker (₺/TL/TRY).
  //   "8 ay 99 TL" → 99, "8 ay 1.290 TL" → 1290, "₺99,99" → 99.99
  // Priority 2: numeric block with thousand separators.
  // Priority 3: any 2+ digit number OR decimal — single-digit "8" rejected.
  let cleaned: string | null = null;

  const currencyRe =
    /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{2,}(?:[.,]\d{1,2})?)\s*(?:TL|TRY|₺)|(?:TL|TRY|₺)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{2,}(?:[.,]\d{1,2})?)/i;
  const curMatch = priceStr.match(currencyRe);
  if (curMatch) {
    cleaned = curMatch[1] || curMatch[2] || null;
  }

  if (!cleaned) {
    const thouMatch = priceStr.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?/);
    if (thouMatch) cleaned = thouMatch[0];
  }

  if (!cleaned) {
    const anyMatch = priceStr.match(/\d{2,}(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}/);
    if (anyMatch) cleaned = anyMatch[0];
  }

  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let num: number;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Turkish: . thousands, , decimal
      num = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    } else {
      // en-US: , thousands, . decimal
      num = parseFloat(cleaned.replace(/,/g, ""));
    }
  } else if (hasComma) {
    const parts = cleaned.split(",");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // "99,99" — Turkish decimal
      num = parseFloat(cleaned.replace(",", "."));
    } else {
      // "1,290" or "1,290,000" — en-US thousands
      num = parseFloat(cleaned.replace(/,/g, ""));
    }
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // "99.99" — decimal
      num = parseFloat(cleaned);
    } else {
      // "1.290" or "1.290.000" — Turkish thousands
      num = parseFloat(cleaned.replace(/\./g, ""));
    }
  } else {
    num = parseFloat(cleaned);
  }

  return isNaN(num) ? null : num;
}

// ============================================
// Serper Shopping API
// ============================================
const SERPER_TIMEOUT_MS = 15_000;

export async function searchProduct(query: string): Promise<SerperShoppingResult[]> {
  // Check cache first
  const cached = await getCachedSerperResults(query);
  if (cached) return cached as SerperShoppingResult[];

  // Cache miss — call Serper API. Fail with a clear message when the key is
  // missing instead of sending `X-API-KEY: undefined` and getting a cryptic
  // upstream 401/403.
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY tanımlı değil — rakip araması yapılamıyor");
  }

  // Proxy'yi BAYPAS eder (directFetch) ve geçici ağ/5xx hatalarında yeniden
  // dener: prod'da aramalar scraping proxy'sinin 502'si yüzünden düşüyor, ürün
  // o turda rakipsiz/güncellenmemiş kalıyordu.
  const res = await withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SERPER_TIMEOUT_MS);
      try {
        return await directFetch("https://google.serper.dev/shopping", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: query,
            gl: "tr",
            hl: "tr",
            num: 20,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    { attempts: 3, shouldRetry: (r) => isTransientStatus(r.status) },
  );

  if (!res.ok) {
    // Kota/auth hataları (401/403/429) tüm rakip keşfini sessizce öldürebilir —
    // gövdedeki mesajı da yakala ki loglar "neden 0 rakip?" sorusunu cevaplasın.
    const bodySnippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      console.error(
        `🚨 SERPER AUTH/KOTA SORUNU: status=${res.status} body="${bodySnippet}" — rakip keşfi ve fiyat kurtarma çalışmayacak`,
      );
    }
    throw new Error(`Serper API hatası: ${res.status}${bodySnippet ? ` — ${bodySnippet}` : ""}`);
  }

  const data = (await res.json()) as { shopping?: SerperShoppingResult[] };
  // Bağlantısız sonuçlar (Google'ın kendi karşılaştırma kartları) hiçbir
  // akışta kullanılamaz ve URL eşleştirmesini çökertiyordu — kaynağında ele.
  const results = (data.shopping ?? []).filter(
    (r) => typeof r?.link === "string" && r.link.trim().length > 0,
  );

  // Cache results
  if (results.length > 0) {
    await setCachedSerperResults(query, results);
  }

  return results;
}

// ============================================
// İkinci rakip kaynağı: pazaryeri ürün sayfaları (Google web araması)
// ============================================
//
// Google Shopping yalnızca satıcının Google'a ürün beslemesi verdiği ilanları
// gösterir; pazaryerlerindeki pek çok ilan (özellikle Hepsiburada/N11 ve küçük
// satıcılar) orada hiç görünmez. Niş ürünlerde keşif bu yüzden "0 rakip" ile
// dönüyordu. Aynı Serper anahtarıyla Google WEB aramasını pazaryeri alan
// adlarına kısıtlayarak ürün sayfalarının kendisini buluruz. Bu sonuçlar çoğu
// zaman fiyat taşımaz — fiyat, worker'ın doğrudan scraper zinciriyle alınır.

/** Web aramasının kısıtlandığı pazaryerleri (hepsinin worker'da scraper'ı var). */
export const MARKETPLACE_SEARCH_DOMAINS = [
  "trendyol.com",
  "hepsiburada.com",
  "n11.com",
  "amazon.com.tr",
  "pazarama.com",
  "pttavm.com",
] as const;

/**
 * URL bir ÜRÜN sayfası mı? Arama/kategori/mağaza/marka sayfaları rakip
 * olamaz; yalnızca pazaryerinin ürün sayfası kalıbına uyanlar kabul edilir.
 */
export function isMarketplaceProductUrl(link: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase();
  if (host === "trendyol.com") return /-p-\d+\/?$/.test(path);
  if (host === "hepsiburada.com") return /-pm?-[a-z0-9]+\/?$/.test(path);
  if (host === "n11.com") return path.startsWith("/urun/");
  if (host === "amazon.com.tr") return /\/(dp|gp\/product)\/[a-z0-9]{10}(\/|$)/.test(path);
  if (host === "pazarama.com") return /-p-[a-z0-9]+\/?$/.test(path);
  if (host === "pttavm.com") return /-p-\d+\/?$/.test(path);
  if (host === "teknosa.com") return /-p-\d+\/?$/.test(path);
  if (host === "vatanbilgisayar.com") return /^\/[^/]+\.html$/.test(path);
  if (host === "mediamarkt.com.tr") return /^\/tr\/product\/[^/]+\.html$/.test(path);
  return false;
}

/** Fiyat karşılaştırma siteleri: satıcı değil, ürün sayfası olarak asla kabul edilmez. */
const PRICE_COMPARISON_HOSTS = ["akakce.com", "cimri.com", "epey.com"];

// Ürün sayfası olamayacak yol parçaları (arama, kategori, marka, mağaza, sepet…).
const NON_PRODUCT_SEGMENTS = new Set([
  "arama",
  "search",
  "ara",
  "kategori",
  "kategoriler",
  "category",
  "categories",
  "collections",
  "c",
  "marka",
  "markalar",
  "brand",
  "brands",
  "magaza",
  "store",
  "kampanya",
  "kampanyalar",
  "blog",
  "sepet",
  "cart",
  "hesap",
  "account",
  "uyelik",
  "yardim",
  "iletisim",
  "liste",
  "list",
]);

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Pazaryeri kalıbı bilinmeyen bir satıcı sitesinde (idefix, D&R, Koçtaş…)
 * URL bir ürün sayfasına benziyor mu? Alan adı (etiket sınırında) eşleşmeli;
 * arama/kategori/marka yolları ve sorgu aramaları elenir; son yol parçası
 * ürün kimliği (5+ rakam) ya da uzun tireli bir slug taşımalı.
 */
export function isLikelyStoreProductUrl(link: string, domain: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (PRICE_COMPARISON_HOSTS.some((d) => hostMatchesDomain(host, d))) return false;
  if (!hostMatchesDomain(host, domain.toLowerCase())) return false;
  if (["q", "query", "search", "k", "keyword"].some((p) => parsed.searchParams.has(p))) {
    return false;
  }
  const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((seg) => NON_PRODUCT_SEGMENTS.has(seg))) return false;
  const last = segments[segments.length - 1].replace(/\.html?$/, "");
  return /\d{5,}/.test(last) || (last.includes("-") && last.length >= 15);
}

export function buildMarketplaceSearchQuery(
  query: string,
  domains: readonly string[] = MARKETPLACE_SEARCH_DOMAINS,
): string {
  const sites = domains.map((d) => `site:${d}`).join(" OR ");
  return domains.length === 1 ? `${query.trim()} ${sites}` : `${query.trim()} (${sites})`;
}

interface SerperOrganicResult {
  title?: string;
  link?: string;
  position?: number;
  price?: number | string;
  currency?: string;
  snippet?: string;
}

/**
 * Organik sonuçları keşif hattının beklediği biçime çevirir: yalnızca ürün
 * sayfaları, fiyat varsa (zengin sonuç) TRY ise taşınır, yoksa boş bırakılır
 * (fiyat sonradan doğrudan taramayla alınır).
 */
export function mapOrganicToShoppingResults(
  organic: SerperOrganicResult[],
  storeDomains: readonly string[] = [],
): SerperShoppingResult[] {
  const out: SerperShoppingResult[] = [];
  for (const r of organic) {
    if (typeof r?.link !== "string" || typeof r?.title !== "string") continue;
    // Pazaryeri ürün sayfası kalıbı ya da (yalnızca istenen satıcı sitelerinde)
    // genel ürün sayfası sezgisi. Fiyat karşılaştırma siteleri hiçbir zaman.
    const link = r.link;
    const accepted =
      isMarketplaceProductUrl(link) ||
      storeDomains.some((domain) => isLikelyStoreProductUrl(link, domain));
    if (!accepted) continue;
    const currencyOk =
      !r.currency || r.currency === "TRY" || r.currency === "TL" || r.currency === "₺";
    let price = "";
    if (currencyOk && typeof r.price === "number" && Number.isFinite(r.price) && r.price > 0) {
      price = r.price.toLocaleString("tr-TR", { minimumFractionDigits: 2 });
    } else if (currencyOk && typeof r.price === "string") {
      price = r.price;
    }
    out.push({
      title: r.title,
      source: "web",
      link: r.link,
      price,
      position: r.position ?? out.length + 1,
      ...(typeof r.snippet === "string" && r.snippet ? { snippet: r.snippet } : {}),
    });
  }
  return out;
}

export async function searchMarketplacePages(
  query: string,
  domains: readonly string[] = MARKETPLACE_SEARCH_DOMAINS,
  options: { storeDomains?: readonly string[] } = {},
): Promise<SerperShoppingResult[]> {
  const storeDomains = options.storeDomains ?? [];
  const fullQuery = buildMarketplaceSearchQuery(query, domains);
  // Shopping önbelleğiyle çakışmaması için ayrı anahtar öneki.
  const cacheKey = `web:${fullQuery}${storeDomains.length > 0 ? "|store" : ""}`;
  const cached = await getCachedSerperResults(cacheKey);
  if (cached) return cached as SerperShoppingResult[];

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY tanımlı değil — rakip araması yapılamıyor");
  }

  const res = await withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SERPER_TIMEOUT_MS);
      try {
        return await directFetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: fullQuery, gl: "tr", hl: "tr", num: 20 }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    { attempts: 3, shouldRetry: (r) => isTransientStatus(r.status) },
  );

  if (!res.ok) {
    const bodySnippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    throw new Error(
      `Serper web arama hatası: ${res.status}${bodySnippet ? ` — ${bodySnippet}` : ""}`,
    );
  }

  const data = (await res.json()) as { organic?: SerperOrganicResult[] };
  const results = mapOrganicToShoppingResults(data.organic ?? [], storeDomains);
  if (results.length > 0) {
    await setCachedSerperResults(cacheKey, results);
  }
  return results;
}
