import { NextRequest } from "next/server";
import { z } from "zod";
import { Marketplace } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";
import { detectMarketplaceFromUrl } from "@/lib/marketplaces";
import { scrapeProduct } from "@/lib/scraper";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addCompetitorScrapeJob } from "@/lib/queue";
import { logger } from "@/lib/logger";

// ============================================
// POST /api/products/[id]/competitors — Manuel rakip ekleme
// ============================================
//
// Niş/markasız ürünlerde otomatik keşif "birebir aynı ürün" bulamayabilir;
// satıcı ise rakibini zaten bilir. Bu uç, kullanıcının yapıştırdığı rakip
// linkini kaydeder. matchScore bilinçli olarak NULL bırakılır — null skor,
// kalite politikasında "kullanıcının bilinçli eklediği kayıt" anlamına gelir
// (yine de fiyat bandı + tazelik kontrolünden geçmeden karara girmez).
//
// Fiyat: önce hızlı sunucu taraması denenir; alınamazsa kayıt fiyatsız açılır
// ve worker'a doğrudan bir scrape işi kuyruklanır (tam zincir: API → HTML →
// Puppeteer). Periyodik Serper döngüsü Google'da birebir görünmeyen URL'lere
// fiyat getiremediği için bu iş manuel rakiplerin tek güvenilir fiyat yoludur.

const addCompetitorSchema = z.object({
  competitorUrl: z
    .string()
    .trim()
    .url("Geçerli bir URL girin")
    .max(500, "URL en fazla 500 karakter olabilir")
    .refine((value) => /^https?:\/\//i.test(value), "Yalnızca http(s) linkleri desteklenir"),
});

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase().replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rl = await rateLimit(`rate:addcomp:${user.id}`, 10, 300);
    if (!rl.success) return rateLimitResponse(rl.reset);

    const { id } = await params;
    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
    });
    if (!product) return notFound("Ürün bulunamadı");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Geçersiz istek gövdesi");
    }
    const parsed = addCompetitorSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const competitorUrl = parsed.data.competitorUrl;
    if (normalizeUrlKey(competitorUrl) === normalizeUrlKey(product.productUrl)) {
      return badRequest("Bu link takip ettiğiniz ürünün kendisi — rakip olarak eklenemez.");
    }

    const marketplace = detectMarketplaceFromUrl(competitorUrl) as Marketplace;

    // Hızlı fiyat denemesi — başarısızlık kaydı engellemez; worker döngüsü doldurur.
    let scrapedPrice: number | null = null;
    let scrapedName: string | null = null;
    try {
      const scraped = await scrapeProduct(competitorUrl, marketplace);
      if (scraped.price && scraped.price > 0) scrapedPrice = scraped.price;
      if (scraped.name) scrapedName = scraped.name.slice(0, 200);
    } catch (err) {
      logger.warn({ err, competitorUrl }, "Manual competitor quick-scrape failed (non-fatal)");
    }

    const competitor = await prisma.competitor.upsert({
      where: {
        trackedProductId_competitorUrl: {
          trackedProductId: product.id,
          competitorUrl,
        },
      },
      update: {
        ...(scrapedName ? { competitorName: scrapedName } : {}),
        ...(scrapedPrice ? { currentPrice: scrapedPrice, lastScrapedAt: new Date() } : {}),
        matchReason: "Manuel eklendi",
      },
      create: {
        trackedProductId: product.id,
        competitorUrl,
        competitorName: scrapedName ?? "Manuel rakip",
        marketplace,
        currentPrice: scrapedPrice,
        lastScrapedAt: scrapedPrice ? new Date() : null,
        matchScore: null,
        matchReason: "Manuel eklendi",
      },
    });

    if (scrapedPrice) {
      await prisma.competitorPrice.create({
        data: {
          competitorId: competitor.id,
          price: scrapedPrice,
          currency: "TRY",
          inStock: true,
        },
      });
    } else {
      // Hızlı tarama fiyat alamadı (Vercel IP'leri bot korumalarına takılır) —
      // worker'a doğrudan scrape işi kuyrukla: tam zincir (API → HTML →
      // Puppeteer) datacenter engellerini aşabiliyor. Serper döngüsüne bel
      // bağlanmaz; Google'da birebir görünmeyen URL'ler orada hiç fiyat alamaz.
      try {
        await addCompetitorScrapeJob(competitor.id);
      } catch (queueError) {
        logger.error(
          { err: queueError, competitorId: competitor.id },
          "Competitor scrape queue error (non-fatal)",
        );
      }
    }

    return apiSuccess(
      {
        success: true,
        competitor: {
          id: competitor.id,
          competitorUrl: competitor.competitorUrl,
          competitorName: competitor.competitorName,
          marketplace: competitor.marketplace,
          currentPrice: competitor.currentPrice,
        },
        priceFetched: Boolean(scrapedPrice),
        message: scrapedPrice
          ? "Rakip eklendi ve fiyatı alındı."
          : "Rakip eklendi. Fiyatı arka planda çekiliyor — birkaç dakika içinde görünecek.",
      },
      201,
    );
  } catch (error) {
    return serverError(error, "POST /api/products/[id]/competitors error");
  }
}
