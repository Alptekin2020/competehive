// ============================================
// Stale competitor price refresh
// ============================================
//
// Rakip fiyatları yalnızca Serper araması aynı URL'yi yeniden döndürdüğünde
// güncelleniyordu; arama sonuçlarından düşen rakipler süresiz bayatlıyor ve
// 72 saatlik tazelik kuralı nedeniyle karar hesaplarından çıkıyordu. Bu döngü
// bilinen rakip URL'lerini DOĞRUDAN, hafif HTTP fetch ile yeniden doğrular —
// Serper (ücretli) ve OpenAI (ücretli) çağrısı YAPMAZ, Puppeteer açmaz.
//
// Güvenlik kemerleri:
//   - shouldAcceptRefreshedPrice: parse hatası kaynaklı saçma fiyatlar yazılmaz
//     (%90 sıçrama kuralı + kendi fiyata göre geniş bant).
//   - Başarısız URL'ler Redis'te 6 saat geri çekilir; aynı kırık URL her turda
//     batch'i işgal etmez.
//   - Tur başına zaman bütçesi vardır; scheduler tıkanmaz.

import { prisma } from "../db";
import { logger } from "../utils/logger";
import { recoverPriceLightweight } from "../utils/recover-price";
import { isPlausiblePriceChange } from "../utils/price-sanity";
import { cacheGet, cacheSet } from "../utils/cache";
import { alertQueue } from "./processor";
import { PURGE_BAND_MIN_RATIO, PURGE_BAND_MAX_RATIO } from "./competitor-cleanup";

// Bu saatten eski rakip fiyatları tazelenmeye aday olur. Görüntüleme tarafının
// 72 saatlik bayatlık eşiğinden bilinçli olarak küçük — veri "Eski"ye düşmeden
// tazelenir.
export const REFRESH_AFTER_HOURS = 12;

const FAIL_BACKOFF_KEY_PREFIX = "comp-refresh-fail:";
const FAIL_BACKOFF_TTL_SECONDS = 6 * 60 * 60;

/**
 * Tazelenen fiyat veritabanına yazılmalı mı? (saf, test edilebilir)
 *
 * - Geçersiz/sıfır fiyat reddedilir.
 * - Önceki fiyata göre %90'dan büyük sıçrama reddedilir (parse hatası işareti).
 * - Kendi fiyat biliniyorsa, temizlik bandının (0.2x–5x) dışına yazım yapılmaz —
 *   görüntüleme bandından (0.3x–3x) bilinçli geniş: meşru fiyat hareketine izin
 *   verir, bariz saçmalığı engeller.
 */
export function shouldAcceptRefreshedPrice(
  previousPrice: number | null,
  nextPrice: number,
  ownPrice: number | null,
): boolean {
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) return false;
  if (!isPlausiblePriceChange(previousPrice, nextPrice)) return false;
  if (ownPrice !== null && Number.isFinite(ownPrice) && ownPrice > 0) {
    if (
      nextPrice < ownPrice * PURGE_BAND_MIN_RATIO ||
      nextPrice > ownPrice * PURGE_BAND_MAX_RATIO
    ) {
      return false;
    }
  }
  return true;
}

export interface CompetitorRefreshStats {
  candidates: number;
  refreshed: number;
  unchanged: number;
  rejected: number;
  failed: number;
  skippedBackoff: number;
  alertsEnqueued: number;
}

interface RefreshOptions {
  batchSize?: number;
  refreshAfterHours?: number;
  maxRunMs?: number;
  now?: Date;
}

// Üst üste binen turlara karşı in-process kilit (scheduleScans ile aynı kalıp).
let isRefreshing = false;

export async function refreshStaleCompetitorPrices(
  options: RefreshOptions = {},
): Promise<CompetitorRefreshStats | null> {
  if (isRefreshing) {
    logger.warn("Competitor price refresh still running — skipping this tick");
    return null;
  }
  isRefreshing = true;
  try {
    return await runRefresh(options);
  } finally {
    isRefreshing = false;
  }
}

async function runRefresh(options: RefreshOptions): Promise<CompetitorRefreshStats> {
  const batchSize = options.batchSize ?? 50;
  const refreshAfterHours = options.refreshAfterHours ?? REFRESH_AFTER_HOURS;
  const maxRunMs = options.maxRunMs ?? 8 * 60 * 1000;
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - refreshAfterHours * 60 * 60 * 1000);

  const stats: CompetitorRefreshStats = {
    candidates: 0,
    refreshed: 0,
    unchanged: 0,
    rejected: 0,
    failed: 0,
    skippedBackoff: 0,
    alertsEnqueued: 0,
  };

  // Backoff'taki satırları eleyebilmek için batch'in iki katı aday çek.
  const candidates = await prisma.competitor.findMany({
    where: {
      OR: [{ lastScrapedAt: null }, { lastScrapedAt: { lt: cutoff } }],
      trackedProduct: {
        status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
        // Plan kapısı: süresi dolmuş ücretli planların ürünleri için maliyet üretme.
        user: {
          OR: [{ planExpiresAt: null }, { planExpiresAt: { gte: now } }],
        },
      },
    },
    orderBy: { lastScrapedAt: { sort: "asc", nulls: "first" } },
    take: batchSize * 2,
    select: {
      id: true,
      competitorUrl: true,
      currentPrice: true,
      trackedProductId: true,
      trackedProduct: {
        select: { currentPrice: true, status: true },
      },
    },
  });

  stats.candidates = candidates.length;
  if (candidates.length === 0) {
    logger.info("Competitor price refresh: no stale competitors");
    return stats;
  }

  // Fiyatı değişen ürünler için tur sonunda tek bir alarm kontrolü kuyruğa girer
  // (COMPETITOR_CHEAPER); kural cooldown'ları tekrarları bastırır.
  const changedProducts = new Map<string, { ownPrice: number; inStock: boolean }>();
  let processed = 0;

  for (const competitor of candidates) {
    if (processed >= batchSize) break;
    if (Date.now() - startedAt > maxRunMs) {
      logger.warn(
        { processed, budgetMs: maxRunMs },
        "Competitor price refresh: time budget exhausted — stopping early",
      );
      break;
    }

    const backoffKey = `${FAIL_BACKOFF_KEY_PREFIX}${competitor.id}`;
    if (await cacheGet<number>(backoffKey)) {
      stats.skippedBackoff++;
      continue;
    }
    processed++;

    const previousPrice = competitor.currentPrice != null ? Number(competitor.currentPrice) : null;
    const ownPrice =
      competitor.trackedProduct?.currentPrice != null
        ? Number(competitor.trackedProduct.currentPrice)
        : null;

    let recoveredPrice: number | null = null;
    let source = "error";
    try {
      const result = await recoverPriceLightweight(competitor.competitorUrl);
      recoveredPrice = result.price;
      source = result.source;
    } catch (err) {
      logger.warn({ competitorId: competitor.id, err }, "Competitor price refresh: fetch threw");
    }

    if (!recoveredPrice || recoveredPrice <= 0) {
      stats.failed++;
      await cacheSet(backoffKey, 1, FAIL_BACKOFF_TTL_SECONDS);
      continue;
    }

    if (!shouldAcceptRefreshedPrice(previousPrice, recoveredPrice, ownPrice)) {
      stats.rejected++;
      logger.warn(
        {
          competitorId: competitor.id,
          previousPrice,
          recoveredPrice,
          ownPrice,
          source,
        },
        "Competitor price refresh: recovered price rejected by sanity policy",
      );
      await cacheSet(backoffKey, 1, FAIL_BACKOFF_TTL_SECONDS);
      continue;
    }

    try {
      // Güncel fiyat ile geçmiş kaydı atomik ve AYNI zaman damgasıyla yazılır —
      // biri başarısız olursa yarım durum oluşmaz, lastScrapedAt/scrapedAt
      // birbirinden sapmaz.
      const refreshedAt = new Date();
      await prisma.$transaction([
        prisma.competitor.update({
          where: { id: competitor.id },
          data: { currentPrice: recoveredPrice, lastScrapedAt: refreshedAt },
        }),
        prisma.competitorPrice.create({
          data: {
            competitorId: competitor.id,
            price: recoveredPrice,
            currency: "TRY",
            inStock: true,
            scrapedAt: refreshedAt,
          },
        }),
      ]);

      const priceChanged =
        previousPrice === null || Math.abs(recoveredPrice - previousPrice) > 0.009;
      if (priceChanged) {
        stats.refreshed++;
        if (ownPrice !== null && ownPrice > 0 && competitor.trackedProduct) {
          changedProducts.set(competitor.trackedProductId, {
            ownPrice,
            inStock: competitor.trackedProduct.status !== "OUT_OF_STOCK",
          });
        }
      } else {
        stats.unchanged++;
      }
    } catch (err) {
      stats.failed++;
      logger.error(
        { competitorId: competitor.id, err },
        "Competitor price refresh: DB update failed",
      );
    }
  }

  for (const [productId, info] of changedProducts) {
    try {
      await alertQueue.add("check-alerts", {
        productId,
        eventTypes: ["competitor-change"],
        currentPrice: info.ownPrice,
        previousPrice: null,
        priceChange: null,
        priceChangePct: null,
        inStock: info.inStock,
        previousInStock: null,
      });
      stats.alertsEnqueued++;
    } catch (err) {
      logger.error({ productId, err }, "Competitor price refresh: alert enqueue failed");
    }
  }

  logger.info(stats, "Competitor price refresh completed");
  return stats;
}
