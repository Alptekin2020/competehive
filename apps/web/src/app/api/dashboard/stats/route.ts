import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [productCount, priceChanges, alertCount, notificationCount] = await Promise.all([
      // Takip edilen ürün sayısı
      prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text as count FROM tracked_products
        WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
      `,
      // Son 24 saatteki fiyat değişimleri
      prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text as count FROM price_history ph
        JOIN tracked_products tp ON tp.id = ph.tracked_product_id
        WHERE tp.user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
          AND ph.scraped_at > NOW() - INTERVAL '24 hours'
          AND ph.price_change IS NOT NULL
          AND ph.price_change != 0
      `,
      // Aktif uyarı kuralı sayısı
      prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text as count FROM alert_rules
        WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
          AND is_active = true
      `,
      // Okunmamış bildirim sayısı
      prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text as count FROM notifications
        WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
          AND is_read = false
      `,
    ]);

    return NextResponse.json({
      trackedProducts: parseInt(productCount[0].count) || 0,
      priceChanges24h: parseInt(priceChanges[0].count) || 0,
      activeAlerts: parseInt(alertCount[0].count) || 0,
      unreadNotifications: parseInt(notificationCount[0].count) || 0,
    });
  } catch (error: any) {
    console.error("GET /api/dashboard/stats error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
