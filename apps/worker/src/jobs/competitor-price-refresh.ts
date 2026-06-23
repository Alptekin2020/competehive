// ============================================
// Periodic competitor discovery + price refresh (Serper-based)
// ============================================
//
// NEDEN BÖYLE: Railway/Vercel datacenter IP'leri pazaryerlerinin bot
// korumalarına (Cloudflare 403, Akamai) takılıyor — rakip sayfalarını DOĞRUDAN
// HTTP ile çekmek (eski recoverPriceLightweight döngüsü) üretimde %100 başarısız
// oluyordu (loglarda "skippedBackoff=7, refreshed=0"). Serper (Google Shopping)
// ise datacenter'dan sorunsuz çalışıyor ve fiyatlı sonuç döndürüyor.
//
// Bu yüzden periyodik tazeleme artık ÜRÜN-merkezli ve tamamen Serper tabanlı:
// her aktif ürün için tek bir keşif turu (processCompetitorJob/runCompetitorDiscovery)
// çalıştırır. Bu tur hem mevcut rakiplerin fiyatını günceller (upsert) hem de
// YENİ rakipleri keşfeder — "7/24 rakip izleme" davranışı. Serper sonuçları 30 dk
// cache'li olduğundan manuel "Rakipleri Tara" ile çakışma maliyet doğurmaz.

import { prisma } from "../db";
import { logger } from "../utils/logger";
import { runCompetitorDiscovery } from "./competitor-processor";

// Bu süreden daha eski "tamamlanmış" ürünler yeniden taranır. Görüntüleme
// tarafının 72 saatlik bayatlık eşiğinin altında tutuyoruz ki rakipler "Eski"ye
// düşmeden tazelensin.
export const REFRESH_AFTER_HOURS = 6;

export interface CompetitorRefreshStats {
  candidates: number;
  processed: number;
  discovered: number;
  failed: number;
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
    logger.warn("Competitor refresh still running — skipping this tick");
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
  const batchSize = options.batchSize ?? 10;
  const refreshAfterHours = options.refreshAfterHours ?? REFRESH_AFTER_HOURS;
  const maxRunMs = options.maxRunMs ?? 8 * 60 * 1000;
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - refreshAfterHours * 60 * 60 * 1000);

  // En uzun süredir taranmamış (veya hiç taranmamış) ürünler önce. Plan kapısı:
  // süresi dolmuş ücretli planların ürünleri için Serper maliyeti üretme.
  const products = await prisma.trackedProduct.findMany({
    where: {
      status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
      user: {
        OR: [{ planExpiresAt: null }, { planExpiresAt: { gte: now } }],
      },
      OR: [{ refreshCompletedAt: null }, { refreshCompletedAt: { lt: cutoff } }],
    },
    orderBy: { refreshCompletedAt: { sort: "asc", nulls: "first" } },
    take: batchSize,
    select: { id: true, productName: true, productUrl: true },
  });

  const stats: CompetitorRefreshStats = {
    candidates: products.length,
    processed: 0,
    discovered: 0,
    failed: 0,
  };

  if (products.length === 0) {
    logger.info("Competitor refresh: no products due");
    return stats;
  }

  for (const product of products) {
    if (Date.now() - startedAt > maxRunMs) {
      logger.warn(
        { processed: stats.processed, budgetMs: maxRunMs },
        "Competitor refresh: time budget exhausted — stopping early",
      );
      break;
    }
    try {
      const result = await runCompetitorDiscovery({
        productId: product.id,
        title: product.productName,
        url: product.productUrl,
      });
      stats.processed++;
      if (result && typeof result.found === "number") {
        stats.discovered += result.found;
      }
    } catch (err) {
      stats.failed++;
      logger.error({ productId: product.id, err }, "Competitor refresh: discovery failed");
    }
  }

  logger.info(stats, "Competitor refresh completed (Serper)");
  return stats;
}
