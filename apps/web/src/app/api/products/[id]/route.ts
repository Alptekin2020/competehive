import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        productName: true,
        marketplace: true,
        productUrl: true,
        productImage: true,
        currentPrice: true,
        currency: true,
        status: true,
        refreshStatus: true,
        refreshRequestedAt: true,
        refreshCompletedAt: true,
        refreshError: true,
        lastScrapedAt: true,
        competitors: {
          orderBy: { currentPrice: "asc" },
          select: {
            id: true,
            competitorUrl: true,
            competitorName: true,
            marketplace: true,
            currentPrice: true,
            lastScrapedAt: true,
            matchScore: true,
            matchReason: true,
          },
        },
        priceHistory: {
          where: { scrapedAt: { gte: thirtyDaysAgo } },
          orderBy: { scrapedAt: "asc" },
          select: {
            id: true,
            trackedProductId: true,
            price: true,
            previousPrice: true,
            currency: true,
            priceChange: true,
            priceChangePct: true,
            inStock: true,
            sellerName: true,
            scrapedAt: true,
          },
        },
      },
    });

    if (!product) {
      return notFound("Ürün bulunamadı");
    }

    const responseProduct = {
      id: product.id,
      productName: product.productName,
      marketplace: product.marketplace,
      productUrl: product.productUrl,
      productImage: product.productImage,
      currentPrice: product.currentPrice,
      currency: product.currency,
      status: product.status,
      refreshStatus: product.refreshStatus,
      refreshRequestedAt: product.refreshRequestedAt,
      refreshCompletedAt: product.refreshCompletedAt,
      refreshError: product.refreshError,
      lastScrapedAt: product.lastScrapedAt,
      priceHistory: product.priceHistory.map(
        (entry: {
          id: bigint;
          trackedProductId: string;
          price: unknown;
          previousPrice: unknown;
          currency: string;
          priceChange: unknown;
          priceChangePct: unknown;
          inStock: boolean;
          sellerName: string | null;
          scrapedAt: Date;
        }) => ({
          id: entry.id.toString(),
          trackedProductId: entry.trackedProductId,
          price: entry.price,
          previousPrice: entry.previousPrice,
          currency: entry.currency,
          priceChange: entry.priceChange,
          priceChangePct: entry.priceChangePct,
          inStock: entry.inStock,
          sellerName: entry.sellerName,
          scrapedAt: entry.scrapedAt,
        }),
      ),
      competitors: product.competitors.map(
        (competitor: {
          id: string;
          competitorUrl: string;
          competitorName: string | null;
          marketplace: unknown;
          currentPrice: unknown;
          lastScrapedAt: Date | null;
          matchScore: number | null;
          matchReason: string | null;
        }) => ({
          id: competitor.id,
          competitorUrl: competitor.competitorUrl,
          competitorName: competitor.competitorName,
          marketplace: competitor.marketplace,
          currentPrice: competitor.currentPrice,
          lastScrapedAt: competitor.lastScrapedAt,
          matchScore: competitor.matchScore,
          matchReason: competitor.matchReason,
        }),
      ),
    };

    return apiSuccess({ product: responseProduct });
  } catch (error) {
    return serverError(error, "Product detail fetch failed");
  }
}
