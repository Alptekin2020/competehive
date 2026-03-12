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

    const notifications = await prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      include: {
        alertRule: {
          select: {
            ruleType: true,
            trackedProduct: {
              select: {
                productName: true,
                marketplace: true,
              },
            },
          },
        },
      },
      orderBy: { sentAt: "desc" },
      take: limit,
    });

    // Map to flat format for frontend compatibility
    const mapped = notifications.map((n) => ({
      id: n.id,
      channel: n.channel,
      title: n.title,
      message: n.message,
      metadata: n.metadata,
      is_read: n.isRead,
      sent_at: n.sentAt,
      rule_type: n.alertRule?.ruleType ?? null,
      product_name: n.alertRule?.trackedProduct?.productName ?? null,
      marketplace: n.alertRule?.trackedProduct?.marketplace ?? null,
    }));

    return NextResponse.json({ notifications: mapped });
  } catch (error) {
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
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true },
      });
    } else if (notificationIds && Array.isArray(notificationIds) && notificationIds.length > 0) {
      await prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: user.id,
        },
        data: { isRead: true },
      });
    } else {
      return NextResponse.json(
        { error: "notificationIds veya markAllRead gerekli" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/notifications error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
