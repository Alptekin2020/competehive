import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, serverError } from "@/lib/api-response";
import { buildCsv } from "@/lib/csv";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { sentAt: "desc" },
      take: 1000,
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
    });

    const headers = [
      "sent_at",
      "title",
      "message",
      "channel",
      "is_read",
      "rule_type",
      "product",
      "marketplace",
    ];

    const rows = notifications.map((item) => [
      item.sentAt.toISOString(),
      item.title,
      item.message,
      item.channel,
      item.isRead ? "yes" : "no",
      item.alertRule?.ruleType ?? "",
      item.alertRule?.trackedProduct?.productName ?? "",
      item.alertRule?.trackedProduct?.marketplace ?? "",
    ]);

    const csv = buildCsv(headers, rows);
    const filename = `competehive-notifications-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return serverError(error, "GET /api/notifications/export");
  }
}
