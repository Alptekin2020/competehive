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

import { MIN_MATCH_SCORE } from "./competitor-quality";

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
}

/**
 * Bilinen bir rakibin bu turdaki yeni fiyatı bir hareket mi? Kalite kapısı
 * COMPETITOR_CHEAPER ile aynı: MIN_MATCH_SCORE altı skorlar karar dışı; null
 * skor manuel/legacy kayıttır ve geçer. Anlamlılık (% eşik) alert worker'da
 * kullanıcının eşiğiyle süzülür — burada yalnızca gerçek değişim aranır.
 */
export function detectCompetitorMove(
  known: Pick<KnownCompetitorSnapshot, "competitorName" | "currentPrice" | "matchScore">,
  newPrice: number,
  newTitle?: string | null,
): CompetitorMove | null {
  const previousPrice = known.currentPrice;
  if (previousPrice === null || !Number.isFinite(previousPrice) || previousPrice <= 0) return null;
  if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice === previousPrice) return null;
  if (known.matchScore !== null && known.matchScore < MIN_MATCH_SCORE) return null;
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

  return competitors
    .filter((c) => !updatedIds.has(c.id))
    .filter((c) => DIRECT_SCRAPE_MARKETPLACES.has(c.marketplace))
    .filter((c) => c.matchScore === null || c.matchScore >= MIN_MATCH_SCORE)
    .filter((c) => c.lastScrapedAt === null || c.lastScrapedAt.getTime() < cutoff)
    .sort((a, b) => (a.lastScrapedAt?.getTime() ?? 0) - (b.lastScrapedAt?.getTime() ?? 0))
    .slice(0, Math.max(0, max));
}
