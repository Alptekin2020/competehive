import { NextRequest } from "next/server";
import { Marketplace } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { searchAllResults, normalizeMarketplaceResult } from "@/lib/marketplace-search";
import { getRetailerInfoFromDomain } from "@competehive/shared";
import type { CompareCompetitorResult } from "@competehive/shared";
import { logger } from "@/lib/logger";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const { productId } = await req.json();
    logger.info({ productId }, "Compare called");
    if (!productId) {
      return badRequest("productId gerekli");
    }

    // Ürünü bul
    const product = await prisma.trackedProduct.findFirst({
      where: { id: productId, userId: user.id },
    });
    if (!product) {
      return notFound("Ürün bulunamadı");
    }

    // Anahtar kelimeler — metadata'dan veya ürün adından
    let keywords: string[] = [];
    try {
      const meta =
        typeof product.metadata === "string"
          ? JSON.parse(product.metadata)
          : (product.metadata as Record<string, unknown> | null);
      if (
        meta?.searchKeywords &&
        Array.isArray(meta.searchKeywords) &&
        meta.searchKeywords.length
      ) {
        keywords = meta.searchKeywords as string[];
      }
    } catch {
      // metadata parse failure, use fallback
    }

    if (keywords.length === 0) {
      keywords = [product.productName.split(" ").slice(0, 5).join(" ")];
    }

    logger.info({ keywords, excludeMarketplace: product.marketplace }, "Compare searching");

    // Tüm web'de ara (marketplace filtresi yok)
    const allResults = await searchAllResults(keywords, product.marketplace);
    logger.info({ totalResults: allResults.length }, "Compare results found");
    const competitors: CompareCompetitorResult[] = [];
    const insertErrors: Array<Record<string, unknown>> = [];
    let skippedCount = 0;
    let errorCount = 0;

    for (const result of allResults) {
      if (!result.price || !result.url) {
        skippedCount += 1;
        continue;
      }

      const normalizedResult = normalizeMarketplaceResult(result, "fallback-custom");
      if (!normalizedResult) {
        skippedCount += 1;
        continue;
      }

      const mp = normalizedResult.marketplace;
      const normalizedUrl = normalizedResult.url.substring(0, 500);
      const compName = normalizedResult.storeName
        ? `${normalizedResult.storeName} — ${normalizedResult.productName}`.substring(0, 200)
        : normalizedResult.productName.substring(0, 200);

      try {
        const comp = await prisma.competitor.upsert({
          where: {
            trackedProductId_competitorUrl: {
              trackedProductId: productId,
              competitorUrl: normalizedUrl,
            },
          },
          update: {
            competitorName: compName,
            marketplace: mp as Marketplace,
            currentPrice: normalizedResult.price,
            lastScrapedAt: new Date(),
          },
          create: {
            trackedProductId: productId,
            competitorUrl: normalizedUrl,
            competitorName: compName,
            marketplace: mp as Marketplace,
            currentPrice: normalizedResult.price,
            lastScrapedAt: new Date(),
          },
        });

        await prisma.competitorPrice.create({
          data: {
            competitorId: comp.id,
            price: normalizedResult.price!,
            currency: "TRY",
            inStock: true,
          },
        });

        let retailerDomain = "unknown";
        try {
          retailerDomain = new URL(normalizedResult.url).hostname.replace("www.", "");
        } catch {
          // invalid URL
        }
        const retailer = getRetailerInfoFromDomain(retailerDomain);
        competitors.push({
          marketplace: mp,
          name: compName,
          price: normalizedResult.price!,
          url: normalizedResult.url,
          link: normalizedResult.url,
          retailerDomain: retailer.retailerDomain,
          retailerName: retailer.retailerName,
          retailerColor: retailer.retailerColor,
        });
      } catch (e: unknown) {
        errorCount += 1;
        const err = e as Error & { code?: string };
        insertErrors.push({
          marketplace: mp,
          url: normalizedUrl,
          message: err?.message ?? "Unknown insert error",
          code: err?.code ?? null,
        });
      }
    }

    if (insertErrors.length) {
      logger.error(
        { productId, totalErrors: insertErrors.length, errors: insertErrors },
        "Competitor insert errors",
      );
    }

    // Sort by price ascending
    competitors.sort((a, b) => a.price - b.price);

    logger.info({ competitorCount: competitors.length }, "Compare complete");

    return apiSuccess({ success: true, competitors, skippedCount, errorCount });
  } catch (error) {
    return serverError(error, "POST /api/products/compare");
  }
}
