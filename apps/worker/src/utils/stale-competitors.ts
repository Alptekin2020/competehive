// ============================================
// 6 saatlik URL-refresh turunun saf yardımcıları
// ============================================
//
// İki müşteri sorununu kapatır:
//
// 1. Rakip hareketi uyarıları: URL-refresh turu bilinen rakiplerin fiyatını
//    Serper'dan günceller ama hareketleri uyarı kuyruğuna hiç iletmiyordu.
//    Kullanıcının kendi fiyatı değişmediyse "rakip ucuzladı / fiyat değiştirdi"
//    bildirimi bu turda hiç gitmiyordu — oysa varsayılan kuralların ikisi tam
//    olarak bu. `detectCompetitorMove` keşif turundaki (competitor-processor)
//    kuralın aynısını uygular.
//
// 2. Bayat rakipler: Google Shopping her turda bilinen her rakibi döndürmez
//    (prod 14 Kasım 15:01: 35 bilinen rakip URL'sinden 4'ü güncellendi). Fiyatı
//    güncellenmeyen rakip 72 saat sonra kalite politikasınca karar
//    hesaplarından sessizce düşüyordu. `pickStaleCompetitorsForDirectScrape`
//    bu rakiplerden sınırlı bir kısmını worker'ın doğrudan scraper zincirine
//    (scrape-competitor işi) yönlendirir.

import {
  isPendingReview,
  MIN_MATCH_SCORE,
  readMatchBasis,
  withinPriceBandForBasis,
} from "./competitor-quality";
import { DEAD_REPROBE_DAYS, readScrapeHealth } from "./dead-listing";

export interface CompetitorMove {
  competitorName: string | null;
  previousPrice: number;
  currentPrice: number;
}

export interface KnownCompetitorSnapshot {
  id: string;
  competitorName: string | null;
  currentPrice: number | null;
  matchScore: number | null;
  marketplace: string;
  lastScrapedAt: Date | null;
  /** Varsa: Google ürün kartı bağlantıları doğrudan taranamaz, seçilmez. */
  competitorUrl?: string | null;
  /** Varsa: `deadAt` / `lastAttemptAt` işaretleri (utils/dead-listing). */
  matchAttributes?: unknown;
}

/** Bağlantı Google'ın kendi sayfası mı (satıcı sayfası değil → taranamaz)? */
export function isGoogleHostedUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    return /(^|\.)google\.[a-z.]+$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Bilinen bir rakibin bu turdaki yeni fiyatı bir hareket mi? Kalite kapısı
 * karar hesaplarıyla aynı (assessCompetitor): onay bekleyen aday hareket
 * üretmez; MIN_MATCH_SCORE altı skor karar dışı (null skor manuel kayıttır,
 * geçer); kendi fiyat verilmişse yeni fiyat eşleşme dayanağının bandında
 * olmalı (model kodu 0.3x–3x, başlık/AI 0.55x–1.8x, onaylı kayıt bantsız).
 * Anlamlılık (% eşik) alert worker'da kullanıcının eşiğiyle süzülür — burada
 * yalnızca gerçek değişim aranır.
 */
export function detectCompetitorMove(
  known: Pick<KnownCompetitorSnapshot, "competitorName" | "currentPrice" | "matchScore"> & {
    matchAttributes?: unknown;
  },
  newPrice: number,
  newTitle?: string | null,
  options: { ownPrice?: number | null } = {},
): CompetitorMove | null {
  const previousPrice = known.currentPrice;
  if (previousPrice === null || !Number.isFinite(previousPrice) || previousPrice <= 0) return null;
  if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice === previousPrice) return null;
  if (isPendingReview(known.matchAttributes)) return null;
  const basis = readMatchBasis(known.matchAttributes, known.matchScore);
  if (basis !== "confirmed" && known.matchScore !== null && known.matchScore < MIN_MATCH_SCORE) {
    return null;
  }
  if (!withinPriceBandForBasis(options.ownPrice, newPrice, basis)) return null;
  return {
    competitorName: newTitle || known.competitorName || null,
    previousPrice,
    currentPrice: newPrice,
  };
}

// Worker'ın kendi scraper'ı olan pazaryerleri. Bağımsız mağaza/bilinmeyen alan
// adları bilerek dışarıda: Serper'ın döndürdüğü rastgele alan adlarını
// otomatik taramak hem maliyet hem güvenlik (SSRF yüzeyi) açısından gereksiz.
export const DIRECT_SCRAPE_MARKETPLACES = new Set([
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
  "MEDIAMARKT",
  "PTTAVM",
  "PAZARAMA",
  "TEKNOSA",
  "VATAN",
]);

// Görüntüleme/karar tarafının 72 saatlik bayatlık eşiğinin rahatça altında:
// iki 6 saatlik tur üst üste kaçırılsa bile rakip "Eski"ye düşmeden tazelenir.
export const STALE_DIRECT_SCRAPE_HOURS = 24;

// Bir URL turunda en fazla bu kadar doğrudan tarama — Puppeteer (Chromium)
// Railway belleğinin çoğu; sınırsız fan-out faturayı büyütür.
export const MAX_DIRECT_SCRAPES_PER_URL = 3;

/**
 * Bu turda Serper'dan güncellenmemiş, eşleşmesi güvenilir ve fiyatı
 * STALE_DIRECT_SCRAPE_HOURS'tan eski bilinen rakipleri seçer — en bayat önce,
 * en fazla `max` adet.
 */
export function pickStaleCompetitorsForDirectScrape(
  competitors: KnownCompetitorSnapshot[],
  updatedIds: Set<string>,
  now: Date,
  opts: { staleHours?: number; max?: number } = {},
): KnownCompetitorSnapshot[] {
  const staleHours = opts.staleHours ?? STALE_DIRECT_SCRAPE_HOURS;
  const max = opts.max ?? MAX_DIRECT_SCRAPES_PER_URL;
  const cutoff = now.getTime() - staleHours * 60 * 60 * 1000;
  const reprobeCutoff = now.getTime() - DEAD_REPROBE_DAYS * 24 * 60 * 60 * 1000;
  // Prod: kategori sayfasına yönlenen ölü bir Hepsiburada ilanı "en bayat"
  // olduğu için 6 turun 6'sında slot aldı. Ölü satır 7 gün sonra bir kez
  // yeniden yoklanır; son 24 saatte denenmiş satır (başarısız olsa da) atlanır.
  const notRecentlyFailed = (c: KnownCompetitorSnapshot): boolean => {
    const health = readScrapeHealth(c.matchAttributes);
    if (health.deadAt) {
      // Yoklama aralığı son denemeden sayılır: başarısız yeniden yoklama
      // ölü satırı bir 7 gün daha dinlendirir (her gün yoklanmaz).
      const lastProbe = new Date(health.lastAttemptAt ?? health.deadAt).getTime();
      if (lastProbe > reprobeCutoff) return false;
    }
    if (health.lastAttemptAt && new Date(health.lastAttemptAt).getTime() > cutoff) return false;
    return true;
  };

  return (
    competitors
      .filter((c) => !updatedIds.has(c.id))
      .filter((c) => DIRECT_SCRAPE_MARKETPLACES.has(c.marketplace))
      // Prod: pazaryeri TRENDYOL kayıtlı ama bağlantısı google.com olan rakip her
      // turda Trendyol scraper'ına gidip Google'ın bot sayfasında boşa düşüyordu.
      .filter((c) => !isGoogleHostedUrl(c.competitorUrl))
      .filter((c) => c.matchScore === null || c.matchScore >= MIN_MATCH_SCORE)
      .filter((c) => c.lastScrapedAt === null || c.lastScrapedAt.getTime() < cutoff)
      .filter(notRecentlyFailed)
      .sort((a, b) => (a.lastScrapedAt?.getTime() ?? 0) - (b.lastScrapedAt?.getTime() ?? 0))
      .slice(0, Math.max(0, max))
  );
}

export interface StaleTrustedCounts {
  /** Güvenilir (skor null ya da ≥ MIN) ve fiyatı 72 saatten eski rakip sayısı. */
  stale: number;
  /** Bunlardan Google ürün kartına bağlı olanlar (doğrudan taranamaz). */
  googleHosted: number;
  /** Bunlardan ölü işaretli olanlar. */
  dead: number;
  /** Değerlendirilen güvenilir rakip sayısı. */
  trusted: number;
}

/**
 * Tur sonunda tazelik ölçümü: karar hesaplarından bayatlık yüzünden düşen
 * (72 saat, COMPETITOR_STALE_HOURS) güvenilir rakipleri sayar. Bu turda
 * güncellenenler taze sayılır.
 */
export function countStaleTrustedCompetitors(
  competitors: KnownCompetitorSnapshot[],
  updatedIds: Set<string>,
  now: Date,
  staleHours = 72,
): StaleTrustedCounts {
  const cutoff = now.getTime() - staleHours * 60 * 60 * 1000;
  const counts: StaleTrustedCounts = { stale: 0, googleHosted: 0, dead: 0, trusted: 0 };
  for (const c of competitors) {
    if (c.matchScore !== null && c.matchScore < MIN_MATCH_SCORE) continue;
    counts.trusted++;
    if (updatedIds.has(c.id)) continue;
    if (c.lastScrapedAt !== null && c.lastScrapedAt.getTime() >= cutoff) continue;
    counts.stale++;
    if (isGoogleHostedUrl(c.competitorUrl)) counts.googleHosted++;
    if (readScrapeHealth(c.matchAttributes).deadAt) counts.dead++;
  }
  return counts;
}
