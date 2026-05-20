import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, serverError } from "@/lib/api-response";
import { decryptToken } from "@/lib/telegram-crypto";
import { sendMessage, TelegramApiError } from "@/lib/telegram-api";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const data = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: {
        telegramBotToken: true,
        telegramChatId: true,
        telegramStatus: true,
      },
    });

    if (!data?.telegramBotToken || !data?.telegramChatId || data.telegramStatus !== "connected") {
      return badRequest("Telegram bağlantısı tamamlanmadı. Önce kurulumu bitir.");
    }

    try {
      const token = decryptToken(data.telegramBotToken);
      await sendMessage(
        token,
        data.telegramChatId,
        [
          "🔔 <b>Test bildirimi</b>",
          "",
          "Bu bir test mesajıdır. Gerçek fiyat değişiklikleri bu formatla gelecek.",
        ].join("\n"),
      );
    } catch (err) {
      if (err instanceof TelegramApiError) {
        return badRequest(`Mesaj gönderilemedi: ${err.message}`);
      }
      throw err;
    }

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "POST /api/telegram/test");
  }
}
