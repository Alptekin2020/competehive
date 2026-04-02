import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

const STALE_MS = 24 * 60 * 60 * 1000;

type PeriodKey = "today" | "7d" | "30d";

const PERIODS: Array<{ key: PeriodKey; hours: number }> = [
  { key: "today", hours: 24 },
  { key: "7d", hours: 24 * 7 },
  { key: "30d", hours: 24 * 30 },
];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const marketplace = searchParams.get("marketplace") || "ALL";
    const tagId = searchParams.get("tagId") || "ALL";
    const executiveRange = (searchParams.get("range") || "7d") as "today" | "7d" | "30d";

    const productWhere = {
      userId: user.id,
      ...(marketplace !== "ALL" ? { marketplace: marketplace as never } : {}),
      ...(tagId !== "ALL"
        ? {
            tags: {
              some: {
                tagId,
              },
            },
          }
        : {}),
    };

    const products = await prisma.trackedProduct.findMany({
      where: productWhere,
      include: {
        competitors: {
          select: {
            currentPrice: true,
          },
        },
        priceHistory: {
          where: {
            scrapedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
          select: {
            scrapedAt: true,
            priceChange: true,
            priceChangePct: true,
          },
          orderBy: { scrapedAt: "desc" },
        },
      },
    });

    const tags = await prisma.tag
      .findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      })
      .catch(() => []);

    const marketplaces = Array.from(new Set(products.map((p) => p.marketplace))).sort();
    const now = Date.now();

    const periods = PERIODS.reduce(
      (acc, period) => {
        const fromMs = now - period.hours * 60 * 60 * 1000;

        const productsWithMovement = products.filter((product) =>
          product.priceHistory.some((history) => {
            const changed = toNumber(history.priceChange);
            return history.scrapedAt.getTime() >= fromMs && changed !== null && changed !== 0;
          }),
        );

        const priceChangesDetected = products.reduce((sum, product) => {
          const inRange = product.priceHistory.filter((history) => {
            const changed = toNumber(history.priceChange);
            return history.scrapedAt.getTime() >= fromMs && changed !== null && changed !== 0;
          });
          return sum + inRange.length;
        }, 0);

        const staleProducts = products.filter((product) => {
          if (!product.lastScrapedAt) return true;
          return now - product.lastScrapedAt.getTime() > STALE_MS;
        }).length;

        const competitorPressureSignals = products.filter((product) => {
          const myPrice = toNumber(product.currentPrice);
          if (myPrice === null) return false;

          const cheaperCompetitorCount = product.competitors.filter((competitor) => {
            const competitorPrice = toNumber(competitor.currentPrice);
            return competitorPrice !== null && competitorPrice < myPrice;
          }).length;

          return cheaperCompetitorCount > 0;
        }).length;

        acc[period.key] = {
          priceChangesDetected,
          productsWithMovement: productsWithMovement.length,
          staleProducts,
          competitorPressureSignals,
        };
        return acc;
      },
      {} as Record<
        PeriodKey,
        {
          priceChangesDetected: number;
          productsWithMovement: number;
          staleProducts: number;
          competitorPressureSignals: number;
        }
      >,
    );

    const executiveHours =
      executiveRange === "30d" ? 24 * 30 : executiveRange === "today" ? 24 : 24 * 7;
    const executiveFrom = new Date(now - executiveHours * 60 * 60 * 1000);
    const productIds = products.map((product) => product.id);

    const mostMoving = products
      .map((product) => {
        const movementCount = product.priceHistory.filter((history) => {
          const changed = toNumber(history.priceChange);
          return history.scrapedAt >= executiveFrom && changed !== null && changed !== 0;
        }).length;

        const absoluteMovePct = product.priceHistory.reduce((maxMove, history) => {
          if (history.scrapedAt < executiveFrom) return maxMove;
          const pct = Math.abs(toNumber(history.priceChangePct) ?? 0);
          return Math.max(maxMove, pct);
        }, 0);

        return {
          productId: product.id,
          productName: product.productName,
          marketplace: product.marketplace,
          movementCount,
          absoluteMovePct,
        };
      })
      .filter((item) => item.movementCount > 0)
      .sort((a, b) => b.movementCount - a.movementCount || b.absoluteMovePct - a.absoluteMovePct)
      .slice(0, 5);

    const mostPressure = products
      .map((product) => {
        const myPrice = toNumber(product.currentPrice);
        const competitorPrices = product.competitors
          .map((competitor) => toNumber(competitor.currentPrice))
          .filter((value): value is number => value !== null);
        const cheaperCount =
          myPrice === null
            ? 0
            : competitorPrices.filter((competitorPrice) => competitorPrice < myPrice).length;
        const minCompetitor = competitorPrices.length ? Math.min(...competitorPrices) : null;
        const gapPct =
          myPrice && minCompetitor && myPrice > 0 && minCompetitor < myPrice
            ? ((myPrice - minCompetitor) / myPrice) * 100
            : 0;

        return {
          productId: product.id,
          productName: product.productName,
          marketplace: product.marketplace,
          cheaperCount,
          gapPct,
        };
      })
      .filter((item) => item.cheaperCount > 0)
      .sort((a, b) => b.cheaperCount - a.cheaperCount || b.gapPct - a.gapPct)
      .slice(0, 5);

    const dataIssues = products
      .map((product) => {
        const stale = !product.lastScrapedAt || now - product.lastScrapedAt.getTime() > STALE_MS;
        const missingPrice = toNumber(product.currentPrice) === null;
        const hasError = product.status === "ERROR";
        const issueScore = Number(stale) + Number(missingPrice) + Number(hasError);
        return {
          productId: product.id,
          productName: product.productName,
          marketplace: product.marketplace,
          stale,
          missingPrice,
          hasError,
          issueScore,
        };
      })
      .filter((item) => item.issueScore > 0)
      .sort((a, b) => b.issueScore - a.issueScore)
      .slice(0, 5);

    const notificationAgg = productIds.length
      ? await prisma.notification.groupBy({
          by: ["alertRuleId"],
          where: {
            userId: user.id,
            sentAt: { gte: executiveFrom },
            alertRule: {
              trackedProductId: { in: productIds },
            },
          },
          _count: { _all: true },
        })
      : [];

    const rules = notificationAgg.length
      ? await prisma.alertRule.findMany({
          where: {
            id: {
              in: notificationAgg
                .map((row) => row.alertRuleId)
                .filter((id): id is string => Boolean(id)),
            },
          },
          select: {
            id: true,
            trackedProductId: true,
            trackedProduct: {
              select: { productName: true, marketplace: true },
            },
          },
        })
      : [];

    const alertCountsByProduct = notificationAgg.reduce((acc, row) => {
      if (!row.alertRuleId) return acc;
      const rule = rules.find((item) => item.id === row.alertRuleId);
      const productId = rule?.trackedProductId;
      if (!productId || !rule?.trackedProduct) return acc;

      const existing = acc.get(productId) ?? {
        productId,
        productName: rule.trackedProduct.productName,
        marketplace: rule.trackedProduct.marketplace,
        alertCount: 0,
      };
      existing.alertCount += row._count._all;
      acc.set(productId, existing);
      return acc;
    }, new Map<string, { productId: string; productName: string; marketplace: string; alertCount: number }>());

    const mostAlerts = Array.from(alertCountsByProduct.values())
      .sort((a, b) => b.alertCount - a.alertCount)
      .slice(0, 5);

    return apiSuccess({
      periods,
      executive: {
        mostMoving,
        mostPressure,
        dataIssues,
        mostAlerts,
      },
      filters: {
        marketplaces,
        tags,
      },
    });
  } catch (error) {
    return serverError(error, "GET /api/dashboard/reporting");
  }
}
