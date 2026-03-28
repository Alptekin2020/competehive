import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";

// PATCH /api/notifications/read — mark notifications as read
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const body = await req.json();
    const { notificationId, markAll } = body;

    if (markAll) {
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true },
      });
      return apiSuccess({ success: true, message: "Tüm bildirimler okundu" });
    }

    if (notificationId) {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId: user.id },
      });

      if (!notification) {
        return notFound("Bildirim bulunamadı");
      }

      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });

      return apiSuccess({ success: true });
    }

    return badRequest("notificationId veya markAll gerekli");
  } catch (error) {
    return serverError(error, "PATCH /api/notifications/read");
  }
}
