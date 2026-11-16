// ============================================
// Tekil rakip doğrudan scrape işi
// ============================================
//
// Manuel eklenen rakiplerin fiyatı web tarafındaki hızlı taramada çoğu zaman
// alınamaz (Vercel IP'leri pazaryerlerinin bot korumalarına takılır) ve
// periyodik tazeleme tamamen Serper tabanlı olduğundan Google Shopping'de
// birebir görünmeyen URL'lerin fiyatı HİÇ dolmuyordu. Bu iş, worker'ın tam
// scraper zincirini (API → HTML → Puppeteer) rakip URL'sine doğrudan uygular —
// Puppeteer, Cloudflare/Akamai engellerini datacenter IP'den de geçebiliyor.

import { prisma } from "../db";
import { logger } from "../utils/logger";
import { Prisma } from "@prisma/client";
import { getScraper, isListingGoneError, isProductUnavailableError } from "../scrapers";
import { extractRetailer, isGoogleHostedLink } from "../serper";
import { MIN_MATCH_SCORE, withinPriceBand } from "../utils/competitor-quality";
import { readMatchReview } from "../utils/match-review";
import { hasPackOrSpecConflict } from "../utils/title-similarity";
import {
  hasScrapeFailureMarks,
  readScrapeHealth,
  withScrapeAttempt,
  withScrapeFailure,
  withScrapeSuccess,
} from "../utils/dead-listing";
import { alertQueue } from "./processor";

export interface CompetitorScrapeJobData {
  competitorId: string;
}

export async function processCompetitorScrapeJob(
  data: CompetitorScrapeJobData,
): Promise<{ success: boolean; price?: number }> {
  const { competitorId } = data;

  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
    select: {
      id: true,
      competitorUrl: true,
      marketplace: true,
      competitorName: true,
      trackedProductId: true,
      currentPrice: true,
      matchScore: true,
      matchAttributes: true,
      trackedProduct: { select: { currentPrice: true, status: true, productName: true } },
    },
  });
  if (!competitor) {
    logger.warn({ competitorId }, "Competitor scrape job: competitor not found (deleted?)");
    return { success: false };
  }

  // Keşfin fiyatsız kaydedip buraya yönlendirdiği otomatik satır (skorlu,
  // kullanıcı onaysız, hiç fiyatı olmamış): tarama sonuç vermezse listede
  // kalıcı bir "fiyat yok" satırı olarak durmamalı — silinir, bir sonraki
  // keşif turu ilan hâlâ yayındaysa yeniden bulur. Manuel eklenen (skoru null)
  // ve kullanıcının onayladığı satırlara dokunulmaz.
  const isAutomated =
    competitor.matchScore !== null && readMatchReview(competitor.matchAttributes) !== "confirmed";
  const neverPriced = competitor.currentPrice === null;
  const dropIfUnpriced = async (reason: string): Promise<boolean> => {
    if (!isAutomated || !neverPriced) return false;
    await prisma.competitor.delete({ where: { id: competitor.id } }).catch((err) => {
      logger.warn({ competitorId, err }, "Unpriced discovery competitor delete failed");
    });
    logger.info(
      { competitorId, reason, url: competitor.competitorUrl.slice(0, 120) },
      "Unpriced discovery competitor removed",
    );
    return true;
  };

  // Başarısız taramayı satıra yaz (ölü ilan / art arda hata sayacı): satır
  // işaretsiz kalırsa bayat seçimi onu her 6 saatlik turda yeniden seçiyordu.
  // Manuel ve onaylı satırlar da işaretlenir ama asla silinmez.
  const markFailure = async (failure: { gone: boolean; reason: string } | null) => {
    const now = new Date();
    const next = failure
      ? withScrapeFailure(competitor.matchAttributes, failure, now)
      : withScrapeAttempt(competitor.matchAttributes, now);
    await prisma.competitor
      .update({
        where: { id: competitor.id },
        data: { matchAttributes: next as Prisma.InputJsonObject },
      })
      .catch((err) => {
        logger.warn({ competitorId, err }, "Competitor scrape failure mark failed");
      });
    const health = readScrapeHealth(next);
    if (health.deadAt) {
      logger.info(
        {
          competitorId,
          reason: health.deadReason,
          failures: health.scrapeFailures,
          url: competitor.competitorUrl.slice(0, 120),
        },
        "Competitor listing marked dead",
      );
    }
  };

  // Google'ın ürün kartı bağlantısı bir satıcı sayfası değildir: scraper'a
  // verilirse Google'ın bot sayfasına düşer ve tur boşa harcanır.
  if (isGoogleHostedLink(competitor.competitorUrl)) {
    logger.info({ competitorId }, "Competitor scrape skipped: Google-hosted link is not scrapable");
    return { success: false };
  }

  const scraper = getScraper(competitor.marketplace);
  // Hata fırlarsa BullMQ job ayarlarına göre yeniden dener.
  let scraped: Awaited<ReturnType<typeof scraper>>;
  try {
    scraped = await scraper(competitor.competitorUrl);
  } catch (err) {
    const gone = isListingGoneError(err);
    if (await dropIfUnpriced(gone ? "listing-gone" : "scrape-failed")) {
      if (gone) return { success: false };
      throw err;
    }
    if (isProductUnavailableError(err)) {
      // Sayfa yüklendi, teklif yok: ilan yaşıyor — hata sayılmaz.
      await markFailure(null);
      return { success: false };
    }
    await markFailure({
      gone,
      reason: gone
        ? "listing-gone"
        : (err instanceof Error ? err.message : String(err)).slice(0, 80),
    });
    // Kalkmış ilanı yeniden denemek boşuna (retryable=false).
    if (gone) return { success: false };
    throw err;
  }

  if (!scraped?.price || scraped.price <= 0) {
    if (!(await dropIfUnpriced("no-price"))) {
      await markFailure({ gone: false, reason: "no-price" });
    }
    throw new Error(
      `Competitor scrape returned no price: ${competitor.competitorUrl.slice(0, 80)}`,
    );
  }

  // Sayfanın gerçek başlığı, keşifte görülen kısaltılmış arama başlığının
  // gizlediği paket/ölçü farkını gösterebilir (prod 15 Kasım: "…100 Gr X 6
  // Adet" ilanı tekli ürünün rakibi olarak yazıldı). Keşfin fiyatsız bıraktığı
  // otomatik satırda böyle bir çelişki varsa fiyat yazılmaz ve satır silinir.
  const ownName = competitor.trackedProduct?.productName ?? "";
  if (
    isAutomated &&
    neverPriced &&
    ownName &&
    scraped.name &&
    hasPackOrSpecConflict(ownName, scraped.name)
  ) {
    logger.warn(
      { competitorId, scrapedName: scraped.name.slice(0, 120) },
      "Competitor page title shows a different pack or size — ignored",
    );
    await dropIfUnpriced("pack-or-size-mismatch");
    return { success: false };
  }

  // Fiyat makullük kapısı (otomatik satırlar): keşif turundaki 0.3x–3x bandının
  // aynısı. Prod vakası (14 Kasım): ~1.010 ₺'lik ısıtıcı için PTT AVM sayfasından
  // 80,34 ₺ okundu (büyük olasılıkla taksit tutarı) ve rakip fiyatı olarak
  // yazıldı. Bant dışı fiyat yazılmaz; kullanıcının elle eklediği rakipte
  // karar kullanıcınındır, kapı uygulanmaz.
  const ownPriceForBand = competitor.trackedProduct?.currentPrice
    ? Number(competitor.trackedProduct.currentPrice)
    : 0;
  if (isAutomated && ownPriceForBand > 0 && !withinPriceBand(ownPriceForBand, scraped.price)) {
    logger.warn(
      { competitorId, price: scraped.price, ownPrice: ownPriceForBand },
      "Competitor direct scrape price outside plausibility band — ignored",
    );
    await dropIfUnpriced("price-out-of-band");
    return { success: false };
  }

  const now = new Date();
  const isPlaceholderName =
    !competitor.competitorName || competitor.competitorName === "Manuel rakip";

  await prisma.competitor.update({
    where: { id: competitor.id },
    data: {
      currentPrice: scraped.price,
      lastScrapedAt: now,
      ...(isPlaceholderName && scraped.name ? { competitorName: scraped.name.slice(0, 200) } : {}),
      // Taze fiyat: ölü işareti ve hata sayacı temizlenir.
      matchAttributes: (hasScrapeFailureMarks(competitor.matchAttributes)
        ? withScrapeSuccess(competitor.matchAttributes, now)
        : withScrapeAttempt(competitor.matchAttributes, now)) as Prisma.InputJsonObject,
    },
  });

  await prisma.competitorPrice.create({
    data: {
      competitorId: competitor.id,
      price: scraped.price,
      currency: scraped.currency || "TRY",
      inStock: scraped.inStock ?? true,
      scrapedAt: now,
    },
  });

  // Grafik tutarlılığı: keşif ve tazeleme yolları gibi priceHistory'ye de yaz —
  // aynı satıcı adı kuralıyla (perakendeci görünen adı; bilinmiyorsa mağaza adı).
  const retailer = extractRetailer(competitor.competitorUrl);
  await prisma.priceHistory.create({
    data: {
      trackedProductId: competitor.trackedProductId,
      price: scraped.price,
      currency: scraped.currency || "TRY",
      inStock: scraped.inStock ?? true,
      sellerName: retailer.name !== "Diğer" ? retailer.name : (scraped.sellerName ?? "Rakip"),
      scrapedAt: now,
    },
  });

  // Rakip fiyat hareketi: manuel taramada fiyat değiştiyse alert kontrolünü
  // kuyruğa al (COMPETITOR_PRICE_CHANGE). Kalite kapısı COMPETITOR_CHEAPER ile
  // aynı: MIN_MATCH_SCORE altı skorlar karar dışı, null skor (manuel kayıt)
  // geçer. Bildirim hatası taramayı düşürmemeli.
  const previousPrice = competitor.currentPrice ? Number(competitor.currentPrice) : null;
  const scoreUsable = competitor.matchScore == null || competitor.matchScore >= MIN_MATCH_SCORE;
  if (previousPrice && previousPrice > 0 && scraped.price !== previousPrice && scoreUsable) {
    try {
      const ownPrice = competitor.trackedProduct?.currentPrice
        ? Number(competitor.trackedProduct.currentPrice)
        : 0;
      await alertQueue.add("check-alerts", {
        productId: competitor.trackedProductId,
        eventTypes: ["competitor-price-change"],
        currentPrice: ownPrice,
        previousPrice: null,
        priceChange: null,
        priceChangePct: null,
        inStock: competitor.trackedProduct?.status !== "OUT_OF_STOCK",
        previousInStock: null,
        competitorMoves: [
          {
            competitorName: competitor.competitorName,
            previousPrice,
            currentPrice: scraped.price,
          },
        ],
      });
    } catch (err) {
      logger.error({ competitorId, err }, "Competitor price-change alert enqueue failed");
    }
  }

  logger.info(
    { competitorId, price: scraped.price, marketplace: competitor.marketplace },
    "Competitor scraped directly",
  );
  return { success: true, price: scraped.price };
}
