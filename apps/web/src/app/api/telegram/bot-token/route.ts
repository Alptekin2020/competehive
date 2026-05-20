import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, serverError } from "@/lib/api-response";
import { decryptToken, encryptToken, generateWebhookSecret } from "@/lib/telegram-crypto";
import { getMe, setWebhook, deleteWebhook, TelegramApiError } from "@/lib/telegram-api";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const botToken = typeof body?.botToken === "string" ? body.botToken.trim() : "";

    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
      return badRequest(
        "Geçersiz bot token formatı. BotFather'dan aldığın tokenı tam olarak yapıştır.",
      );
    }

    // 1. Doğrula
    let botInfo;
    try {
      botInfo = await getMe(botToken);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        return badRequest(`Bot doğrulanamadı: ${err.message}`);
      }
      throw err;
    }

    if (!botInfo.is_bot || !botInfo.username) {
      return badRequest("Bu token bir bot'a ait değil.");
    }

    // 2. Bu bot zaten başka bir kullanıcıya ait mi?
    const existingOwner = await prisma.user.findFirst({
      where: {
        telegramBotUsername: botInfo.username,
        NOT: { clerkId: user.clerkId },
      },
      select: { id: true },
    });

    if (existingOwner) {
      return badRequest(
        "Bu bot zaten başka bir CompeteHive hesabına bağlı. BotFather'da yeni bir bot oluşturup onun tokenını kullan.",
      );
    }

    // 3. Mevcut user'ın eski botu varsa onun webhook'unu temizle
    const currentRecord = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: { telegramBotToken: true, telegramBotUsername: true },
    });

    if (currentRecord?.telegramBotToken && currentRecord.telegramBotUsername !== botInfo.username) {
      try {
        const oldToken = decryptToken(currentRecord.telegramBotToken);
        await deleteWebhook(oldToken);
      } catch (err) {
        console.error("Failed to deleteWebhook for previous bot (continuing):", err);
      }
    }

    // 4. Webhook secret üret
    const webhookSecret = generateWebhookSecret();

    // 5. App URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!appUrl) {
      return serverError(new Error("NEXT_PUBLIC_APP_URL not set"), "POST /api/telegram/bot-token");
    }
    const webhookUrl = `${appUrl}/api/telegram/webhook`;

    // 6. setWebhook
    try {
      await setWebhook(botToken, webhookUrl, webhookSecret);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        return badRequest(`Webhook kurulamadı: ${err.message}`);
      }
      throw err;
    }

    // 7. Token şifrele + DB
    const encryptedToken = encryptToken(botToken);

    await prisma.user.update({
      where: { clerkId: user.clerkId },
      data: {
        telegramBotToken: encryptedToken,
        telegramBotUsername: botInfo.username,
        telegramWebhookSecret: webhookSecret,
        telegramStatus: "awaiting_start",
        telegramChatId: null,
        telegramConnectedAt: null,
      },
    });

    return apiSuccess({
      botUsername: botInfo.username,
      botFirstName: botInfo.first_name,
      deepLink: `https://t.me/${botInfo.username}`,
      status: "awaiting_start",
    });
  } catch (error) {
    return serverError(error, "POST /api/telegram/bot-token");
  }
}
