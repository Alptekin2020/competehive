import { NextRequest } from "next/server";
import { Marketplace, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { searchAllResults, normalizeMarketplaceResult } from "@/lib/marketplace-search";
import { getRetailerInfoFromDomain, MIN_MATCH_SCORE } from "@competehive/shared";
import type { CompareCompetitorResult } from "@competehive/shared";
import { logger } from "@/lib/logger";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";
import { compareSchema } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { verifyProductMatch, withinPriceBand, type MatchAttributes } from "@/lib/matcher";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    // Rate limit: 5 compares per minute per user
    const rl = await rateLimit(`rate:compare:${user.id}`, 5, 60);
    if (!rl.success) return rateLimitResponse(rl.reset);

    const body = await req.json();
    const parsed = compareSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const { productId } = parsed.data;
    logger.info({ productId }, "Compare called");

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
      // Akıllı fallback: tam isim + model numarası olmadan versiyon
      const fullName = product.productName;
      keywords = [fullName];

      // Model numarasını tespit et ve kaldırılmış versiyonu da ekle
      const modelPattern = /\b[A-Z0-9](?:[A-Z0-9-/]){4,}[A-Z0-9]\b/i;
      const modelMatch = fullName.match(modelPattern);
      if (modelMatch) {
        const withoutModel = fullName
          .replace(modelPattern, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        if (withoutModel.length >= 5) {
          keywords.push(withoutModel);
        }
        // Sadece model kodu ile de ara
        if (modelMatch[0].length >= 5) {
          keywords.push(modelMatch[0]);
        }
      }
    }

    logger.info({ keywords, excludeMarketplace: product.marketplace }, "Compare searching");

    // Tüm web'de ara (marketplace filtresi yok)
    const allResults = await searchAllResults(keywords, product.marketplace);
    logger.info({ totalResults: allResults.length }, "Compare results found");

    // Worker tarafıyla aynı kalite filtreleri uygulanıyor:
    //   1) Fiyat bandı: kaynak fiyatın 0.3x–3x'i dışındakileri reddet.
    //   2) AI matcher (OpenAI varsa): score >= MIN_MATCH_SCORE değilse reddet.
    // Bu sayede "Rakipleri Tara" da kolikutugelsin / kitap / aksesuar gibi alakasız
    // ürünlerle DB'yi kirletmiyor.
    const sourcePrice = product.currentPrice ? Number(product.currentPrice) : null;
    const sourceTitle = product.productName;
    const aiAvailable = !!process.env.OPENAI_API_KEY;

    const competitors: CompareCompetitorResult[] = [];
    const insertErrors: Array<Record<string, unknown>> = [];
    let skippedCount = 0;
    let priceFilteredCount = 0;
    let aiRejectedCount = 0;
    let errorCount = 0;

    for (const result of allResults) {
      if (!result.price || !result.url) {
        skippedCount += 1;
        continue;
      }

      const normalizedResult = normalizeMarketplaceResult(result, "fallback-custom");
      if (!normalizedResult || normalizedResult.price === null) {
        skippedCount += 1;
        continue;
      }

      const candidatePrice = normalizedResult.price;

      // 1) Fiyat bandı pre-filter
      if (sourcePrice && sourcePrice > 0 && !withinPriceBand(sourcePrice, candidatePrice)) {
        priceFilteredCount += 1;
        continue;
      }

      const mp = normalizedResult.marketplace;
      const normalizedUrl = normalizedResult.url.substring(0, 500);
      const compName = normalizedResult.storeName
        ? `${normalizedResult.storeName} — ${normalizedResult.productName}`.substring(0, 200)
        : normalizedResult.productName.substring(0, 200);

      // 2) AI matcher — sadece OpenAI varsa. Yoksa fiyat bandını geçenleri kaydet.
      let matchScore: number | null = null;
      let matchReason: string | null = null;
      let matchAttributes: MatchAttributes | null = null;

      if (aiAvailable) {
        try {
          const matchResult = await verifyProductMatch(
            {
              title: sourceTitle,
              price: sourcePrice ?? undefined,
              marketplace: product.marketplace,
            },
            {
              title: normalizedResult.productName,
              url: normalizedResult.url,
              price: candidatePrice,
              marketplace: normalizedResult.marketplace,
            },
          );

          matchScore = matchResult.score;
          matchReason = matchResult.reason;
          matchAttributes = matchResult.attributes;

          if (!matchResult.isMatch) {
            aiRejectedCount += 1;
            continue;
          }
        } catch {
          aiRejectedCount += 1;
          continue;
        }
      }

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
            currentPrice: candidatePrice,
            lastScrapedAt: new Date(),
            ...(matchScore !== null
              ? {
                  matchScore,
                  matchReason,
                  matchAttributes: matchAttributes as unknown as Prisma.InputJsonValue,
                }
              : {}),
          },
          create: {
            trackedProductId: productId,
            competitorUrl: normalizedUrl,
            competitorName: compName,
            marketplace: mp as Marketplace,
            currentPrice: candidatePrice,
            lastScrapedAt: new Date(),
            ...(matchScore !== null
              ? {
                  matchScore,
                  matchReason,
                  matchAttributes: matchAttributes as unknown as Prisma.InputJsonValue,
                }
              : {}),
          },
        });

        await prisma.competitorPrice.create({
          data: {
            competitorId: comp.id,
            price: candidatePrice,
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
          price: candidatePrice,
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

    logger.info(
      {
        productId,
        kept: competitors.length,
        priceFiltered: priceFilteredCount,
        aiRejected: aiRejectedCount,
        skipped: skippedCount,
        minMatchScore: MIN_MATCH_SCORE,
        aiAvailable,
      },
      "Compare filtering stats",
    );

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
