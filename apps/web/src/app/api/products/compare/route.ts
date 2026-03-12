import { NextRequest, NextResponse } from "next/server";
import { Marketplace } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { searchAllResults, normalizeMarketplaceResult } from "@/lib/marketplace-search";
import { getRetailerInfoFromDomain } from "@competehive/shared";
import type { CompareCompetitorResult } from "@competehive/shared";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId } = await req.json();
    console.log("[CompeteHive Compare] Called with productId:", productId);
    if (!productId) {
      return NextResponse.json({ error: "productId gerekli" }, { status: 400 });
    }

    // Ürünü bul
    const product = await prisma.trackedProduct.findFirst({
      where: { id: productId, userId: user.id },
    });
    if (!product) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
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

    console.log("Compare searching for:", keywords, "excluding:", product.marketplace);

    // Tüm web'de ara (marketplace filtresi yok)
    const allResults = await searchAllResults(keywords, product.marketplace);
    console.log("[CompeteHive Compare] Total results:", allResults.length);
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
            price: normalizedResult.price,
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
          price: normalizedResult.price,
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
      console.error("[CompeteHive Compare] Competitor insert errors", {
        productId,
        totalErrors: insertErrors.length,
        errors: insertErrors,
      });
    }

    // Sort by price ascending
    competitors.sort((a, b) => a.price - b.price);

    console.log("Found competitors:", competitors.length);

    return NextResponse.json({ success: true, competitors, skippedCount, errorCount });
  } catch (error) {
    console.error("Compare error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
