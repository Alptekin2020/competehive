export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest } from "next/server";
import { Marketplace, ProductStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { scrapeProduct } from "@/lib/scraper";
import { analyzeProduct } from "@/lib/ai-analyzer";
import { detectMarketplaceFromUrl } from "@/lib/marketplaces";
import { logger } from "@/lib/logger";
import { apiSuccess, unauthorized, badRequest, forbidden, serverError } from "@/lib/api-response";
import { addProductSchema } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addScrapeJob, addCompetitorSearchJob } from "@/lib/queue";

// GET - Kullanicinin urunlerini ve rakip fiyatlarini listele
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const products = await prisma.trackedProduct.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        competitors: {
          orderBy: { currentPrice: "asc" },
        },
        priceHistory: {
          orderBy: { scrapedAt: "desc" },
          take: 2,
          select: {
            price: true,
            previousPrice: true,
            priceChange: true,
            priceChangePct: true,
            scrapedAt: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: { id: true, name: true, color: true },
            },
          },
        },
        _count: {
          select: { competitors: true },
        },
      },
    });

    // Map to snake_case for frontend compatibility + enrich with trend data
    const mapped = products.map((p) => {
      const latestHistory = p.priceHistory[0];
      return {
        id: p.id,
        product_name: p.productName,
        marketplace: p.marketplace,
        product_url: p.productUrl,
        product_image: p.productImage,
        current_price: p.currentPrice,
        last_scraped_at: p.lastScrapedAt,
        status: p.status,
        trend: latestHistory
          ? {
              priceChange: latestHistory.priceChange ? Number(latestHistory.priceChange) : null,
              priceChangePct: latestHistory.priceChangePct
                ? Number(latestHistory.priceChangePct)
                : null,
              lastUpdated: latestHistory.scrapedAt,
            }
          : null,
        tags: p.tags.map((pt) => ({ tag: pt.tag })),
        competitorCount: p._count.competitors,
        competitors: p.competitors.map((c) => ({
          id: c.id,
          marketplace: c.marketplace,
          competitor_name: c.competitorName,
          current_price: c.currentPrice,
          competitor_url: c.competitorUrl,
        })),
      };
    });

    return apiSuccess({ products: mapped });
  } catch (error) {
    return serverError(error, "GET /api/products error");
  }
}

// POST - Yeni urun ekle + AI analiz + capraz marketplace arama
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    // Rate limit: 10 products per minute per user
    const rl = await rateLimit(`rate:products:${user.id}`, 10, 60);
    if (!rl.success) return rateLimitResponse(rl.reset);

    const body = await req.json();
    const parsed = addProductSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const { productUrl } = parsed.data;

    const marketplace = detectMarketplaceFromUrl(productUrl);

    const productCount = await prisma.trackedProduct.count({
      where: { userId: user.id },
    });
    if (productCount >= user.maxProducts) {
      return forbidden(`Urun limitinize ulastiniz (${user.maxProducts}). Planinizi yukseltin.`);
    }

    // 1. Urun sayfasini scrape et
    let scraped;
    try {
      scraped = await scrapeProduct(productUrl, marketplace);
    } catch (err) {
      logger.error({ err }, "Scrape error");
      scraped = {
        name: "Urun adi alinamadi",
        price: null,
        currency: "TRY",
        image: null,
        seller: null,
        inStock: true,
      };
    }

    // 2. AI ile urunu analiz et (marka, model, arama kelimeleri)
    let analysis;
    try {
      analysis = await analyzeProduct(scraped.name, marketplace, scraped.price);
    } catch (err) {
      logger.error({ err }, "AI analysis error");
      analysis = {
        brand: "Bilinmiyor",
        model: scraped.name.substring(0, 50),
        category: "Genel",
        searchKeywords: [scraped.name.split(" ").slice(0, 4).join(" ")],
        shortTitle: scraped.name.substring(0, 80),
      };
    }

    // 3. Görsel URL temizleme — bazen JSON object geliyor
    let cleanImage: string | null = null;
    if (scraped.image) {
      if (typeof scraped.image === "string") {
        cleanImage = scraped.image;
      } else if (typeof scraped.image === "object") {
        const imgObj = scraped.image as Record<string, unknown>;
        if (imgObj.contentUrl) {
          cleanImage = Array.isArray(imgObj.contentUrl)
            ? (imgObj.contentUrl[0] as string)
            : (imgObj.contentUrl as string);
        } else if (imgObj.url) {
          cleanImage = imgObj.url as string;
        } else if (Array.isArray(imgObj) && imgObj.length > 0) {
          cleanImage = typeof imgObj[0] === "string" ? imgObj[0] : null;
        }
      }
    }

    // 4. Urunu veritabanina kaydet
    const productName = analysis.shortTitle || scraped.name;
    const productStatus = scraped.inStock ? ProductStatus.ACTIVE : ProductStatus.OUT_OF_STOCK;

    const product = await prisma.trackedProduct.create({
      data: {
        userId: user.id,
        productName,
        marketplace: marketplace as Marketplace,
        productUrl,
        productImage: cleanImage,
        sellerName: scraped.seller,
        currentPrice: scraped.price,
        currency: scraped.currency,
        status: productStatus,
        lastScrapedAt: new Date(),
        metadata: {
          brand: analysis.brand,
          model: analysis.model,
          category: analysis.category,
          searchKeywords: analysis.searchKeywords,
        },
      },
    });

    // Queue initial scrape and competitor search
    try {
      await addScrapeJob(product.id, marketplace, productUrl);
      await addCompetitorSearchJob(product.id, product.productName || productUrl, marketplace);
    } catch (queueError) {
      // Log but don't fail the request - product was saved successfully
      console.error("Queue error (non-fatal):", queueError);
    }

    // 5. Fiyat gecmisine kaydet
    if (scraped.price) {
      await prisma.priceHistory.create({
        data: {
          trackedProductId: product.id,
          price: scraped.price,
          currency: scraped.currency,
          inStock: scraped.inStock,
          sellerName: scraped.seller,
        },
      });
    }

    // 6. Trigger scrape fallback
    try {
      const baseUrl = req.nextUrl.origin;
      fetch(`${baseUrl}/api/scrape/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify({ productId: product.id }),
      }).catch((err) => logger.error({ err }, "Scrape trigger fire-and-forget error"));
    } catch (err) {
      logger.error({ err }, "Scrape trigger setup error");
    }

    return apiSuccess({
      success: true,
      product: {
        id: product.id,
        product_name: product.productName,
        marketplace: product.marketplace,
        product_url: product.productUrl,
        product_image: product.productImage,
        current_price: product.currentPrice,
      },
      analysis,
    });
  } catch (error) {
    return serverError(error, "POST /api/products error");
  }
}

// DELETE - Urun sil
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("id");

    if (!productId) return badRequest("Urun ID gerekli");

    // Cascade handles competitors automatically
    await prisma.trackedProduct.deleteMany({
      where: { id: productId, userId: user.id },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/products error");
  }
}
