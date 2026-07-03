export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest } from "next/server";
import { Marketplace, ProductStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { scrapeProduct } from "@/lib/scraper";
import { analyzeProduct } from "@/lib/ai-analyzer";
import {
  detectMarketplaceFromUrl,
  isScraperSupportedMarketplace,
  SUPPORTED_MARKETPLACE_LABEL,
} from "@/lib/marketplaces";
import { logger } from "@/lib/logger";
import { apiSuccess, unauthorized, badRequest, serverError } from "@/lib/api-response";
import { addProductSchema } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addScrapeJob, addCompetitorSearchJob } from "@/lib/queue";
import { getEffectiveFeatures } from "@/lib/plan-gates";
import { canAddProduct } from "@/lib/limits";
import { ensureDefaultGlobalAlertRules } from "@/lib/default-alerts";
import { normalizeProductImage } from "@competehive/shared";

// GET - Kullanicinin urunlerini ve rakip fiyatlarini listele

function isMissingTagSchemaError(error: unknown): boolean {
  const prismaError = error as { code?: unknown; meta?: { table?: unknown } } | undefined;
  if (prismaError?.code === "P2021") {
    const table = String(prismaError.meta?.table ?? "").toLowerCase();
    if (table.includes("tags") || table.includes("product_tags")) return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    (message.includes("public.tags") || message.includes("public.product_tags")) &&
    message.includes("does not exist")
  );
}

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
          select: {
            id: true,
            marketplace: true,
            competitorName: true,
            currentPrice: true,
            competitorUrl: true,
            matchScore: true,
            lastScrapedAt: true,
          },
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
        _count: {
          select: { competitors: true },
        },
      },
    });

    const productIds = products.map((p) => p.id);
    let tagsByProductId = new Map<
      string,
      Array<{ tag: { id: string; name: string; color: string } }>
    >();

    if (productIds.length > 0) {
      try {
        const productTags = await prisma.productTag.findMany({
          where: { productId: { in: productIds } },
          include: {
            tag: {
              select: { id: true, name: true, color: true },
            },
          },
        });

        tagsByProductId = productTags.reduce((map, pt) => {
          const existing = map.get(pt.productId) ?? [];
          existing.push({ tag: pt.tag });
          map.set(pt.productId, existing);
          return map;
        }, new Map<string, Array<{ tag: { id: string; name: string; color: string } }>>());
      } catch (error) {
        if (isMissingTagSchemaError(error)) {
          console.warn(
            "[GET /api/products] tag tables are missing during rollout; returning products with empty tags",
          );
        } else {
          throw error;
        }
      }
    }

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
        cost: p.cost,
        last_scraped_at: p.lastScrapedAt,
        // Son BAŞARILI fiyat güncellemesi: PriceHistory yalnızca başarılı
        // taramada yazılır. lastScrapedAt ise "son deneme"dir (başarısız
        // taramada da ilerler) — tazelik rozetleri bu alanı kullanmalı.
        last_success_at: latestHistory?.scrapedAt ?? null,
        status: p.status,
        refresh_status: p.refreshStatus,
        refresh_error: p.refreshError,
        trend: latestHistory
          ? {
              priceChange: latestHistory.priceChange ? Number(latestHistory.priceChange) : null,
              priceChangePct: latestHistory.priceChangePct
                ? Number(latestHistory.priceChangePct)
                : null,
              lastUpdated: latestHistory.scrapedAt,
            }
          : null,
        tags: tagsByProductId.get(p.id) ?? [],
        competitorCount: p._count.competitors,
        competitors: p.competitors.map((c) => ({
          id: c.id,
          marketplace: c.marketplace,
          competitor_name: c.competitorName,
          current_price: c.currentPrice,
          competitor_url: c.competitorUrl,
          match_score: c.matchScore,
          last_scraped_at: c.lastScrapedAt,
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
  const logContext: {
    userId?: string;
    productUrl?: string;
    marketplace?: string;
  } = {};

  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    logContext.userId = user.id;

    // Plan limit gate (Whop subscription state + per-tier product cap)
    const planCheck = await canAddProduct(user.id);
    if (!planCheck.allowed) {
      return new Response(
        JSON.stringify({
          error: planCheck.reason,
          code: "PLAN_LIMIT_REACHED",
          current: planCheck.current,
          limit: planCheck.limit,
          plan: planCheck.plan,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Rate limit: 10 products per minute per user
    const rl = await rateLimit(`rate:products:${user.id}`, 10, 60);
    if (!rl.success) return rateLimitResponse(rl.reset);

    const body = await req.json();
    const parsed = addProductSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const { productUrl } = parsed.data;
    logContext.productUrl = productUrl;

    const marketplace = detectMarketplaceFromUrl(productUrl);
    logContext.marketplace = marketplace;

    if (!isScraperSupportedMarketplace(marketplace)) {
      return badRequest(
        `Bu pazar yeri henüz desteklenmiyor. Desteklenen pazar yerleri: ${SUPPORTED_MARKETPLACE_LABEL}.`,
      );
    }

    // Ayni URL ikinci kez eklenirse plan kotasi bosuna tukenir ve ayni urun
    // iki kez taranir — toplu ekleme ucuyla ayni kontrol burada da yapilir.
    const existingProduct = await prisma.trackedProduct.findFirst({
      where: { userId: user.id, productUrl },
      select: { id: true },
    });
    if (existingProduct) {
      return badRequest("Bu ürün zaten takip ediliyor.");
    }

    const productCount = await prisma.trackedProduct.count({
      where: { userId: user.id },
    });
    if (productCount >= user.maxProducts) {
      return new Response(
        JSON.stringify({
          error: `Ürün limitinize ulaştınız (${user.maxProducts}). Planınızı yükseltin.`,
          code: "PLAN_LIMIT_REACHED",
          current: productCount,
          limit: user.maxProducts,
          plan: user.plan,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Marketplace limit check (etkin plan: süresi dolmuş abonelik FREE sayılır)
    const features = getEffectiveFeatures(user);
    if (features.marketplaceLimit < 99) {
      const usedMarketplaces = await prisma.trackedProduct.groupBy({
        by: ["marketplace"],
        where: { userId: user.id },
      });

      const alreadyUsing = usedMarketplaces.some(
        (m) => m.marketplace === (marketplace as Marketplace),
      );

      if (!alreadyUsing && usedMarketplaces.length >= features.marketplaceLimit) {
        return new Response(
          JSON.stringify({
            error: `Mevcut planınızla en fazla ${features.marketplaceLimit} marketplace kullanabilirsiniz. Daha fazlası için planınızı yükseltin.`,
            upgradeRequired: true,
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // 1. Urun sayfasini scrape et
    let scraped;
    try {
      scraped = await scrapeProduct(productUrl, marketplace);
    } catch (err) {
      logger.error({ err }, "Scrape error");
      scraped = {
        name: "Ürün adı alınamadı",
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

    // 3. Görsel URL normalize et — Prisma String? alanına sadece string/null gitsin
    const cleanImage = normalizeProductImage(scraped.image);

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
        scrapeInterval: features.scrapeIntervalMinutes,
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

    // 6. Hesap geneli varsayilan bildirim kurallarini olustur (yalnizca ilk
    // urunde; kullanicinin zaten kurali varsa no-op). Genel kurallar tum
    // urunlere uygulanir — urun basina kural olusturmak plan kotasini ilk
    // birkac urunde tuketiyordu ve sonraki urunler sessizce alarmsiz kaliyordu.
    try {
      const { created, skipped } = await ensureDefaultGlobalAlertRules({
        userId: user.id,
        plan: user.plan,
        alertThresholdPct: user.alertThresholdPct,
      });

      logger.info(
        { userId: user.id, productId: product.id, created, skipped },
        "Default global alert rules ensured",
      );
    } catch (err) {
      logger.error({ err }, "Default alert rules error (non-fatal)");
    }

    // 7. Trigger scrape fallback
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

    // Liste sayfasi bu nesneyi oldugu gibi basa ekler (GET ile ayni sekil):
    // last_scraped_at/status eksik kalirsa saniyelik urun "Veri Eski" gorunur.
    return apiSuccess({
      success: true,
      product: {
        id: product.id,
        product_name: product.productName,
        marketplace: product.marketplace,
        product_url: product.productUrl,
        product_image: product.productImage,
        current_price: product.currentPrice,
        cost: product.cost,
        last_scraped_at: product.lastScrapedAt,
        status: product.status,
        refresh_status: null,
        refresh_error: null,
        trend: null,
        tags: [],
        competitorCount: 0,
        competitors: [],
      },
      analysis,
    });
  } catch (error) {
    logger.error(
      {
        route: "POST /api/products",
        ...logContext,
        err: error,
      },
      "Product creation failed",
    );
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

    if (!productId) return badRequest("Ürün ID gerekli");

    // Cascade handles competitors automatically
    await prisma.trackedProduct.deleteMany({
      where: { id: productId, userId: user.id },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/products error");
  }
}
