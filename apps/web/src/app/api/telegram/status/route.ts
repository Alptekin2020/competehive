import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const data = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: {
        telegramStatus: true,
        telegramChatId: true,
        telegramConnectedAt: true,
        telegramLinkTokenExpiresAt: true,
      },
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || null;

    return apiSuccess({
      botUsername,
      status: data?.telegramStatus || null,
      hasChatId: Boolean(data?.telegramChatId),
      connectedAt: data?.telegramConnectedAt || null,
      linkExpiresAt: data?.telegramLinkTokenExpiresAt || null,
    });
  } catch (error) {
    return serverError(error, "GET /api/telegram/status");
  }
}
