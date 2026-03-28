import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError, forbidden } from "@/lib/api-response";

// POST /api/notifications/test — create a test notification (dev only)
export async function POST() {
  try {
    if (process.env.NODE_ENV === "production") {
      return forbidden("Bu endpoint sadece geliştirme ortamında kullanılabilir");
    }

    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        channel: "EMAIL",
        title: "📉 Fiyat düştü: Test Ürün",
        message:
          "Test Ürün fiyatı 1.299,00 ₺'den 1.199,00 ₺'ye düştü (-100,00 ₺, %7.7). Marketplace: Trendyol.",
        metadata: {
          productName: "Test Ürün",
          currentPrice: 1199,
          previousPrice: 1299,
          priceChange: -100,
          priceChangePct: -7.7,
          marketplace: "TRENDYOL",
          productUrl: "https://www.trendyol.com/test",
          ruleType: "PRICE_DROP",
        },
        isRead: false,
      },
    });

    return apiSuccess(notification);
  } catch (error) {
    return serverError(error, "Test notification creation failed");
  }
}
