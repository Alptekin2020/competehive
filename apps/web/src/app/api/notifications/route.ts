import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

// GET /api/notifications - Kullanıcının bildirimlerini listele
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    let notifications;
    if (unreadOnly) {
      notifications = await prisma.$queryRaw<any[]>`
        SELECT n.*, ar.rule_type, tp.product_name, tp.marketplace
        FROM notifications n
        LEFT JOIN alert_rules ar ON ar.id = n.alert_rule_id
        LEFT JOIN tracked_products tp ON ar.tracked_product_id = tp.id
        WHERE n.user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
          AND n.is_read = false
        ORDER BY n.sent_at DESC
        LIMIT ${limit}
      `;
    } else {
      notifications = await prisma.$queryRaw<any[]>`
        SELECT n.*, ar.rule_type, tp.product_name, tp.marketplace
        FROM notifications n
        LEFT JOIN alert_rules ar ON ar.id = n.alert_rule_id
        LEFT JOIN tracked_products tp ON ar.tracked_product_id = tp.id
        WHERE n.user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
        ORDER BY n.sent_at DESC
        LIMIT ${limit}
      `;
    }

    return NextResponse.json({ notifications });
  } catch (error: any) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}

// PATCH /api/notifications - Bildirimleri okundu olarak işaretle
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { notificationIds, markAllRead } = body;

    if (markAllRead) {
      await prisma.$queryRaw`
        UPDATE notifications SET is_read = true
        WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
          AND is_read = false
      `;
    } else if (notificationIds && Array.isArray(notificationIds) && notificationIds.length > 0) {
      for (const nId of notificationIds) {
        await prisma.$queryRaw`
          UPDATE notifications SET is_read = true
          WHERE id = ${nId}::uuid
            AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
        `;
      }
    } else {
      return NextResponse.json({ error: "notificationIds veya markAllRead gerekli" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH /api/notifications error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
