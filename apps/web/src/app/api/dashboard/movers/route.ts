import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

// GET /api/dashboard/movers — products with biggest price changes in last 24h
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentChanges = await prisma.priceHistory.findMany({
      where: {
        trackedProduct: { userId: user.id },
        scrapedAt: { gte: oneDayAgo },
        priceChangePct: { not: null },
        NOT: { priceChange: 0 },
      },
      orderBy: { scrapedAt: "desc" },
      take: 50,
      select: {
        price: true,
        previousPrice: true,
        priceChange: true,
        priceChangePct: true,
        scrapedAt: true,
        trackedProduct: {
          select: {
            id: true,
            productName: true,
            marketplace: true,
            currentPrice: true,
            productImage: true,
          },
        },
      },
    });

    // Deduplicate by product (keep latest entry per product)
    const seen = new Set<string>();
    const unique = recentChanges.filter((entry) => {
      const id = entry.trackedProduct.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Sort by absolute percentage change (biggest movers first)
    unique.sort((a, b) => Math.abs(Number(b.priceChangePct)) - Math.abs(Number(a.priceChangePct)));

    // Take top 5
    const topMovers = unique.slice(0, 5).map((entry) => ({
      productId: entry.trackedProduct.id,
      productName: entry.trackedProduct.productName,
      marketplace: entry.trackedProduct.marketplace,
      productImage: entry.trackedProduct.productImage,
      currentPrice: Number(entry.trackedProduct.currentPrice),
      priceChange: Number(entry.priceChange),
      priceChangePct: Number(entry.priceChangePct),
      updatedAt: entry.scrapedAt,
    }));

    return apiSuccess({ movers: topMovers });
  } catch (error) {
    return serverError(error, "GET /api/dashboard/movers error");
  }
}
