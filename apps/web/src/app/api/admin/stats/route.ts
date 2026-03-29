import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const [
      totalUsers,
      totalProducts,
      totalCompetitors,
      totalPriceHistory,
      totalAlertRules,
      totalNotifications,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.trackedProduct.count(),
      prisma.competitor.count(),
      prisma.priceHistory.count(),
      prisma.alertRule.count(),
      prisma.notification.count(),
    ]);

    const productsByStatus = await prisma.trackedProduct.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    const productsByMarketplace = await prisma.trackedProduct.groupBy({
      by: ["marketplace"],
      _count: { id: true },
    });

    const usersByPlan = await prisma.user.groupBy({
      by: ["plan"],
      _count: { id: true },
    });

    return NextResponse.json({
      totals: {
        users: totalUsers,
        products: totalProducts,
        competitors: totalCompetitors,
        priceHistory: totalPriceHistory,
        alertRules: totalAlertRules,
        notifications: totalNotifications,
      },
      productsByStatus: Object.fromEntries(productsByStatus.map((r) => [r.status, r._count.id])),
      productsByMarketplace: Object.fromEntries(
        productsByMarketplace.map((r) => [r.marketplace, r._count.id]),
      ),
      usersByPlan: Object.fromEntries(usersByPlan.map((r) => [r.plan, r._count.id])),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "İstatistikler yüklenemedi" }, { status: 500 });
  }
}
