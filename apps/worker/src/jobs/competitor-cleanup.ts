// ============================================
// Legacy junk-competitor cleanup
// ============================================
//
// Kalite filtreleri (fiyat bandı + AI matcher + ambalaj kara listesi) sonradan
// eklendiği için eski keşif turlarından kalan alakasız rakipler DB'de duruyor
// (ör. ₺2.500'lük terliğe bağlanmış ₺11'lik koliler). Hiçbir akış bu kayıtları
// geriye dönük temizlemediği için piyasa pozisyonu ve COMPETITOR_CHEAPER
// alarmı kalıcı olarak kirleniyordu.
//
// Bu job worker açılışında bir kez çalışır ve YALNIZCA bariz çöpü siler:
//   1) Ambalaj/koli/lojistik ürünü adları (kaynak ürün ambalaj değilken)
//   2) Skoru olmayan/zayıf kayıtlarda aşırı fiyat sapması (0.2x–5x dışı) —
//      görüntüleme bandından (0.3x–3x) bilerek daha geniş; silme geri alınamaz,
//      bu yüzden sadece kesin vakaları kapsar.
// Güçlü AI skoru (>= MIN_MATCH_SCORE) olan kayıtlar fiyat sapsa bile silinmez —
// fiyat meşru şekilde değişmiş olabilir; onları görüntüleme katmanı zaten
// karar dışı bırakıyor.

import { prisma } from "../db";
import { logger } from "../utils/logger";
import { MIN_MATCH_SCORE, isPackagingListing } from "../utils/competitor-quality";

// Silme bandı — görüntüleme bandından bilinçli olarak daha geniş.
export const PURGE_BAND_MIN_RATIO = 0.2;
export const PURGE_BAND_MAX_RATIO = 5.0;

export type PurgeReason = "packaging" | "price-out-of-band" | null;

export interface PurgeCandidate {
  competitorName: string | null;
  competitorPrice: number | null;
  matchScore: number | null;
}

export interface PurgeContext {
  productName: string;
  ownPrice: number | null;
}

/**
 * Saf karar fonksiyonu: bu rakip kaydı kesin çöp mü?
 * null → tut; aksi halde silme nedeni döner.
 */
export function shouldPurgeCompetitor(
  candidate: PurgeCandidate,
  context: PurgeContext,
): PurgeReason {
  if (
    candidate.competitorName &&
    isPackagingListing(candidate.competitorName, context.productName)
  ) {
    return "packaging";
  }

  const strongScore =
    candidate.matchScore !== null &&
    candidate.matchScore !== undefined &&
    candidate.matchScore >= MIN_MATCH_SCORE;

  if (
    !strongScore &&
    context.ownPrice !== null &&
    context.ownPrice > 0 &&
    candidate.competitorPrice !== null &&
    candidate.competitorPrice > 0
  ) {
    const min = context.ownPrice * PURGE_BAND_MIN_RATIO;
    const max = context.ownPrice * PURGE_BAND_MAX_RATIO;
    if (candidate.competitorPrice < min || candidate.competitorPrice > max) {
      return "price-out-of-band";
    }
  }

  return null;
}

const PAGE_SIZE = 500;

/**
 * Tüm rakip kayıtlarını sayfalayarak tarar ve kesin çöpleri siler
 * (CompetitorPrice satırları cascade ile temizlenir). Idempotent ve ucuz —
 * her worker açılışında güvenle çalıştırılabilir.
 */
export async function cleanupJunkCompetitors(): Promise<{
  scanned: number;
  purged: number;
  byReason: Record<string, number>;
}> {
  let scanned = 0;
  let purged = 0;
  const byReason: Record<string, number> = {};
  let cursor: string | null = null;

  for (;;) {
    const batch: Array<{
      id: string;
      competitorName: string | null;
      currentPrice: unknown;
      matchScore: number | null;
      trackedProduct: { productName: string; currentPrice: unknown } | null;
    }> = await prisma.competitor.findMany({
      take: PAGE_SIZE,
      // Keyset sayfalama (id > cursor): Prisma `cursor` sayfalaması cursor
      // kaydının var olmasını gerektirir — sayfanın son kaydı bu döngüde
      // silinmiş olabileceği için cursor tabanlı sayfalama çöker/yarım kalır.
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: "asc" },
      select: {
        id: true,
        competitorName: true,
        currentPrice: true,
        matchScore: true,
        trackedProduct: {
          select: { productName: true, currentPrice: true },
        },
      },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    const toDelete: string[] = [];
    for (const row of batch) {
      if (!row.trackedProduct) continue;
      const reason = shouldPurgeCompetitor(
        {
          competitorName: row.competitorName,
          competitorPrice: row.currentPrice != null ? Number(row.currentPrice) : null,
          matchScore: row.matchScore,
        },
        {
          productName: row.trackedProduct.productName,
          ownPrice:
            row.trackedProduct.currentPrice != null
              ? Number(row.trackedProduct.currentPrice)
              : null,
        },
      );
      if (reason) {
        toDelete.push(row.id);
        byReason[reason] = (byReason[reason] ?? 0) + 1;
        logger.info(
          {
            competitorId: row.id,
            name: row.competitorName?.slice(0, 80),
            reason,
          },
          "Junk competitor purged",
        );
      }
    }

    if (toDelete.length > 0) {
      await prisma.competitor.deleteMany({ where: { id: { in: toDelete } } });
      purged += toDelete.length;
    }

    if (batch.length < PAGE_SIZE) break;
  }

  logger.info({ scanned, purged, byReason }, "Junk-competitor cleanup completed");
  return { scanned, purged, byReason };
}

// ============================================
// Legacy marketplace backfill (CUSTOM → gerçek pazaryeri)
// ============================================
//
// Retailer çıkarımı sonradan geldiği için eski rakip kayıtları marketplace=CUSTOM
// ile duruyor; UI rozetlerinde "Diğer", Analitik'te "27 rakibin 22'si Diğer"
// olarak görünüyordu. URL'den pazaryerini türetip düzeltir. Idempotent.

const URL_MARKETPLACE_MAP: Array<{ domain: string; marketplace: string }> = [
  { domain: "trendyol.com", marketplace: "TRENDYOL" },
  { domain: "hepsiburada.com", marketplace: "HEPSIBURADA" },
  { domain: "amazon.com.tr", marketplace: "AMAZON_TR" },
  { domain: "n11.com", marketplace: "N11" },
  { domain: "pazarama.com", marketplace: "PAZARAMA" },
  { domain: "mediamarkt.com.tr", marketplace: "MEDIAMARKT" },
  { domain: "teknosa.com", marketplace: "TEKNOSA" },
  { domain: "vatanbilgisayar.com", marketplace: "VATAN" },
  { domain: "decathlon.com.tr", marketplace: "DECATHLON" },
  { domain: "pttavm.com", marketplace: "PTTAVM" },
  { domain: "ciceksepeti.com", marketplace: "CICEKSEPETI" },
  { domain: "akakce.com", marketplace: "AKAKCE" },
  { domain: "cimri.com", marketplace: "CIMRI" },
  { domain: "epey.com", marketplace: "EPEY" },
  { domain: "boyner.com.tr", marketplace: "BOYNER" },
  { domain: "watsons.com.tr", marketplace: "WATSONS" },
  { domain: "kitapyurdu.com", marketplace: "KITAPYURDU" },
  { domain: "sephora.com.tr", marketplace: "SEPHORA" },
  { domain: "koctas.com.tr", marketplace: "KOCTAS" },
  { domain: "itopya.com", marketplace: "ITOPYA" },
  { domain: "gratis.com", marketplace: "GRATIS" },
];

export function marketplaceFromUrl(url: string): string | null {
  const lower = (url || "").toLowerCase();
  for (const entry of URL_MARKETPLACE_MAP) {
    if (lower.includes(entry.domain)) return entry.marketplace;
  }
  return null;
}

export async function backfillCompetitorMarketplaces(): Promise<{ updated: number }> {
  const rows = await prisma.competitor.findMany({
    where: { marketplace: "CUSTOM" },
    select: { id: true, competitorUrl: true },
  });
  let updated = 0;
  for (const row of rows) {
    const marketplace = marketplaceFromUrl(row.competitorUrl);
    if (!marketplace) continue;
    try {
      await prisma.competitor.update({
        where: { id: row.id },
        // Prisma enum tipine string ataması: değerler enum sabitleriyle birebir.
        data: { marketplace: marketplace as never },
      });
      updated++;
    } catch (err) {
      logger.error({ err, competitorId: row.id }, "Marketplace backfill failed for row");
    }
  }
  if (updated > 0)
    logger.info({ updated, scanned: rows.length }, "Competitor marketplace backfill completed");
  return { updated };
}
