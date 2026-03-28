import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const userId = user.id;

    // 1. Products per marketplace with status breakdown
    const productsByMarketplace = await prisma.trackedProduct.groupBy({
      by: ["marketplace", "status"],
      where: { userId },
      _count: { id: true },
    });

    // 2. Competitors per marketplace with avg match score
    const competitorStats = await prisma.competitor.groupBy({
      by: ["marketplace"],
      where: {
        trackedProduct: { userId },
      },
      _count: { id: true },
      _avg: { matchScore: true },
    });

    // 3. Price history entries per marketplace (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentPriceUpdates = await prisma.priceHistory.groupBy({
      by: ["trackedProductId"],
      where: {
        trackedProduct: { userId },
        scrapedAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
    });

    // Get marketplace for each product to map price updates to marketplaces
    const productMarketplaceMap = await prisma.trackedProduct.findMany({
      where: { userId },
      select: { id: true, marketplace: true, lastScrapedAt: true },
    });

    const marketplaceMap = new Map<string, { marketplace: string; lastScrapedAt: Date | null }>(
      productMarketplaceMap.map(
        (p: { id: string; marketplace: string; lastScrapedAt: Date | null }) => [
          p.id,
          { marketplace: p.marketplace, lastScrapedAt: p.lastScrapedAt },
        ],
      ),
    );

    // 4. Aggregate per marketplace
    const marketplaces: Record<
      string,
      {
        totalProducts: number;
        activeProducts: number;
        errorProducts: number;
        pausedProducts: number;
        competitorCount: number;
        avgMatchScore: number | null;
        priceUpdates7d: number;
        lastScrapedAt: string | null;
      }
    > = {};

    const emptyStats = () => ({
      totalProducts: 0,
      activeProducts: 0,
      errorProducts: 0,
      pausedProducts: 0,
      competitorCount: 0,
      avgMatchScore: null,
      priceUpdates7d: 0,
      lastScrapedAt: null,
    });

    // Initialize from products
    for (const row of productsByMarketplace) {
      const mp = row.marketplace;
      if (!marketplaces[mp]) {
        marketplaces[mp] = emptyStats();
      }
      marketplaces[mp].totalProducts += row._count.id;
      if (row.status === "ACTIVE") marketplaces[mp].activeProducts += row._count.id;
      if (row.status === "ERROR") marketplaces[mp].errorProducts += row._count.id;
      if (row.status === "PAUSED") marketplaces[mp].pausedProducts += row._count.id;
    }

    // Add competitor stats
    for (const row of competitorStats) {
      const mp = row.marketplace;
      if (!marketplaces[mp]) {
        marketplaces[mp] = emptyStats();
      }
      marketplaces[mp].competitorCount = row._count.id;
      marketplaces[mp].avgMatchScore = row._avg.matchScore ? Math.round(row._avg.matchScore) : null;
    }

    // Add price update counts
    for (const row of recentPriceUpdates) {
      const productInfo = marketplaceMap.get(row.trackedProductId);
      if (productInfo) {
        const mp = productInfo.marketplace;
        if (marketplaces[mp]) {
          marketplaces[mp].priceUpdates7d += row._count.id;
        }
      }
    }

    // Add last scraped timestamps
    for (const [, info] of marketplaceMap) {
      const mp = info.marketplace;
      if (marketplaces[mp] && info.lastScrapedAt) {
        const current = marketplaces[mp].lastScrapedAt;
        if (!current || new Date(info.lastScrapedAt) > new Date(current)) {
          marketplaces[mp].lastScrapedAt = info.lastScrapedAt.toISOString();
        }
      }
    }

    // Calculate success rates
    const result = Object.entries(marketplaces).map(([marketplace, stats]) => ({
      marketplace,
      ...stats,
      successRate:
        stats.totalProducts > 0
          ? Math.round((stats.activeProducts / stats.totalProducts) * 100)
          : 0,
      errorRate:
        stats.totalProducts > 0 ? Math.round((stats.errorProducts / stats.totalProducts) * 100) : 0,
    }));

    // Sort by total products descending
    result.sort((a, b) => b.totalProducts - a.totalProducts);

    // Overall summary
    const summary = {
      totalProducts: result.reduce((s, r) => s + r.totalProducts, 0),
      totalCompetitors: result.reduce((s, r) => s + r.competitorCount, 0),
      totalPriceUpdates7d: result.reduce((s, r) => s + r.priceUpdates7d, 0),
      activeMarketplaces: result.filter((r) => r.totalProducts > 0).length,
      overallSuccessRate: (() => {
        const total = result.reduce((s, r) => s + r.totalProducts, 0);
        const active = result.reduce((s, r) => s + r.activeProducts, 0);
        return total > 0 ? Math.round((active / total) * 100) : 0;
      })(),
      overallAvgMatchScore: (() => {
        const withScore = result.filter((r) => r.avgMatchScore !== null);
        if (withScore.length === 0) return null;
        return Math.round(
          withScore.reduce((s, r) => s + (r.avgMatchScore || 0), 0) / withScore.length,
        );
      })(),
    };

    return NextResponse.json({ marketplaces: result, summary });
  } catch (error) {
    console.error("Marketplace stats error:", error);
    return NextResponse.json({ error: "İstatistikler yüklenemedi" }, { status: 500 });
  }
}
