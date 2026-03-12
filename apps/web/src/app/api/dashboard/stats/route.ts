import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [trackedProducts, priceChanges24h, activeAlerts, unreadNotifications] = await Promise.all(
      [
        prisma.trackedProduct.count({
          where: { userId: user.id },
        }),
        prisma.priceHistory.count({
          where: {
            trackedProduct: { userId: user.id },
            scrapedAt: { gt: twentyFourHoursAgo },
            priceChange: { not: null },
            NOT: { priceChange: 0 },
          },
        }),
        prisma.alertRule.count({
          where: { userId: user.id, isActive: true },
        }),
        prisma.notification.count({
          where: { userId: user.id, isRead: false },
        }),
      ],
    );

    return apiSuccess({
      trackedProducts,
      priceChanges24h,
      activeAlerts,
      unreadNotifications,
    });
  } catch (error) {
    return serverError(error, "GET /api/dashboard/stats");
  }
}
