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
import { getScraper } from "../scrapers";
import { extractRetailer } from "../serper";
import { MIN_MATCH_SCORE } from "../utils/competitor-quality";
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
      trackedProduct: { select: { currentPrice: true, status: true } },
    },
  });
  if (!competitor) {
    logger.warn({ competitorId }, "Competitor scrape job: competitor not found (deleted?)");
    return { success: false };
  }

  const scraper = getScraper(competitor.marketplace);
  // Hata fırlarsa BullMQ job ayarlarına göre yeniden dener.
  const scraped = await scraper(competitor.competitorUrl);

  if (!scraped?.price || scraped.price <= 0) {
    throw new Error(
      `Competitor scrape returned no price: ${competitor.competitorUrl.slice(0, 80)}`,
    );
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
