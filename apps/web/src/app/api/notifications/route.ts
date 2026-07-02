import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, serverError } from "@/lib/api-response";

// GET /api/notifications - Kullanıcının bildirimlerini listele (pagination destekli)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
    const offset = parseInt(searchParams.get("offset") || "0");

    const where = {
      userId: user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          alertRule: {
            select: {
              ruleType: true,
              trackedProduct: {
                select: {
                  id: true,
                  productName: true,
                  marketplace: true,
                },
              },
            },
          },
        },
        orderBy: { sentAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);

    // Map to flat format for frontend compatibility
    const mapped = notifications.map((n: (typeof notifications)[number]) => ({
      id: n.id,
      channel: n.channel,
      title: n.title,
      message: n.message,
      metadata: n.metadata,
      status: n.status,
      error: n.error,
      is_read: n.isRead,
      sent_at: n.sentAt,
      rule_type: n.alertRule?.ruleType ?? null,
      product_id: n.alertRule?.trackedProduct?.id ?? null,
      product_name: n.alertRule?.trackedProduct?.productName ?? null,
      marketplace: n.alertRule?.trackedProduct?.marketplace ?? null,
    }));

    return apiSuccess({
      notifications: mapped,
      total,
      unreadCount,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    // Surface the real failure (message + stack) in Vercel function logs so a
    // lingering 500 after the schema reconcile can be diagnosed. The client
    // response stays the generic "Sunucu hatası" produced by serverError().
    console.error("[notifications] GET failed:", error);
    return serverError(error, "GET /api/notifications");
  }
}

// PATCH /api/notifications - Bildirimleri okundu olarak işaretle
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
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
      return badRequest("notificationIds veya markAllRead gerekli");
    }

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "PATCH /api/notifications");
  }
}
