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

  logger.info(
    { competitorId, price: scraped.price, marketplace: competitor.marketplace },
    "Competitor scraped directly",
  );
  return { success: true, price: scraped.price };
}
