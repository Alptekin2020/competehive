import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

// GET /api/notifications/unread-count — lightweight endpoint for header badge polling
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });

    return apiSuccess({ unreadCount });
  } catch (error) {
    return serverError(error, "GET /api/notifications/unread-count");
  }
}
