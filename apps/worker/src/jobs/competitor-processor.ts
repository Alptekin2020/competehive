import { Worker, Job } from "bullmq";
import { Marketplace, PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

const prisma = new PrismaClient();

const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
  maxRetriesPerRequest: null,
};

const MARKETPLACE_DOMAINS: Record<string, string> = {
  "trendyol.com": "TRENDYOL",
  "hepsiburada.com": "HEPSIBURADA",
  "amazon.com.tr": "AMAZON_TR",
  "n11.com": "N11",
  "mediamarkt.com.tr": "MEDIAMARKT",
};

type SerperShoppingItem = {
  link?: string;
  title?: string;
  price?: string;
};

type SerperShoppingResponse = {
  shopping?: SerperShoppingItem[];
};

function detectMarketplaceFromUrl(url: string): string | null {
  for (const [domain, marketplace] of Object.entries(MARKETPLACE_DOMAINS)) {
    if (url.includes(domain)) return marketplace;
  }
  return null;
}

async function searchWithSerper(
  productName: string,
  excludeMarketplace: string,
): Promise<Array<{ url: string; title: string; price: number; marketplace: string }>> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.warn("SERPER_API_KEY not set, skipping competitor search");
    return [];
  }

  // Clean product name - remove brand codes and size info for better search
  const cleanName = productName
    .replace(/\s*\d+\s*(ml|gr|adet|cm|mm|gb|tb|gb)\b/gi, "")
    .substring(0, 100)
    .trim();

  // Use Serper.dev API
  const serperResponse = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: cleanName,
      gl: "tr",
      hl: "tr",
      num: 20,
    }),
  });

  if (!serperResponse.ok) {
    logger.error(`Serper API error: ${serperResponse.status}`);
    return [];
  }

  const data = (await serperResponse.json()) as SerperShoppingResponse;
  const results: Array<{ url: string; title: string; price: number; marketplace: string }> = [];

  for (const item of data.shopping || []) {
    const link = item.link || "";
    const marketplace = detectMarketplaceFromUrl(link);

    // Skip if same marketplace as the tracked product
    if (!marketplace || marketplace === excludeMarketplace) continue;

    // Parse price from Serper result
    const priceStr = (item.price || "").replace(/[^\d,.]/g, "").replace(",", ".");
    const price = parseFloat(priceStr) || 0;

    if (link && price > 0) {
      results.push({
        url: link,
        title: item.title || "",
        price,
        marketplace,
      });
    }
  }

  return results;
}

export const competitorWorker = new Worker(
  "competitors",
  async (job: Job) => {
    const { productId, productName, marketplace } = job.data;
    logger.info({ productId, productName }, "Competitor search started");

    try {
      const competitors = await searchWithSerper(productName, marketplace);
      logger.info(`Found ${competitors.length} potential competitors for ${productName}`);

      // Save to DB - upsert to avoid duplicates
      for (const comp of competitors) {
        await prisma.competitor.upsert({
          where: {
            trackedProductId_competitorUrl: {
              trackedProductId: productId,
              competitorUrl: comp.url,
            },
          },
          create: {
            trackedProductId: productId,
            competitorUrl: comp.url,
            competitorName: comp.title,
            marketplace: comp.marketplace as Marketplace,
            currentPrice: comp.price,
            lastScrapedAt: new Date(),
          },
          update: {
            currentPrice: comp.price,
            competitorName: comp.title,
            lastScrapedAt: new Date(),
          },
        });
      }

      logger.info({ productId, count: competitors.length }, "Competitor search completed");
    } catch (error) {
      logger.error({ error, productId }, "Competitor search failed");
      throw error;
    }
  },
  { connection },
);
