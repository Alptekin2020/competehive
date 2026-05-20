import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";
import { decryptToken } from "@/lib/telegram-crypto";
import { deleteWebhook } from "@/lib/telegram-api";

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const data = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: { telegramBotToken: true },
    });

    if (data?.telegramBotToken) {
      try {
        const token = decryptToken(data.telegramBotToken);
        await deleteWebhook(token);
      } catch (err) {
        console.error("Failed to deleteWebhook on Telegram (continuing):", err);
      }
    }

    await prisma.user.update({
      where: { clerkId: user.clerkId },
      data: {
        telegramBotToken: null,
        telegramBotUsername: null,
        telegramWebhookSecret: null,
        telegramStatus: null,
        telegramChatId: null,
        telegramConnectedAt: null,
      },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/telegram/disconnect");
  }
}
