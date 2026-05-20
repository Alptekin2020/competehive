import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decryptToken } from "@/lib/telegram-crypto";
import { sendMessage } from "@/lib/telegram-api";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { telegramWebhookSecret: secret },
      select: {
        id: true,
        telegramBotToken: true,
        telegramChatId: true,
        telegramStatus: true,
      },
    });

    if (!user || !user.telegramBotToken) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update: TelegramUpdate = await req.json();
    const message = update.message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text.trim();
    const chatId = String(message.chat.id);
    const botToken = decryptToken(user.telegramBotToken);

    // /start handling
    if (text.startsWith("/start")) {
      if (!user.telegramChatId) {
        // First /start — lock to this chat
        await prisma.user.update({
          where: { id: user.id },
          data: {
            telegramChatId: chatId,
            telegramStatus: "connected",
            telegramConnectedAt: new Date(),
          },
        });

        await sendMessage(
          botToken,
          chatId,
          [
            "✅ <b>CompeteHive bildirimleri aktif!</b>",
            "",
            "Artık takip ettiğin ürünlerdeki fiyat değişikliklerini, stok hareketlerini ve rakip uyarılarını anında buradan göreceksin.",
            "",
            "<b>Komutlar:</b>",
            "/status — Aktif takip durumu",
            "/test — Test bildirimi gönder",
            "/stop — Bildirimleri durdur",
          ].join("\n"),
        );
      } else if (user.telegramChatId === chatId) {
        if (user.telegramStatus === "stopped") {
          await prisma.user.update({
            where: { id: user.id },
            data: { telegramStatus: "connected" },
          });
          await sendMessage(botToken, chatId, "✅ Bildirimler yeniden aktifleştirildi.");
        } else {
          await sendMessage(
            botToken,
            chatId,
            "✅ Zaten bağlısın. Bildirimler bu sohbete gelmeye devam ediyor.",
          );
        }
      } else {
        // First-wins: bu bot başka chat'e bağlı
        await sendMessage(
          botToken,
          chatId,
          "❌ Bu bot başka bir Telegram hesabına bağlı. Bildirim almak için CompeteHive'da o hesapla giriş yapan kullanıcı olmalısın.",
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Diğer tüm komutlar için bağlı chat olmak şart
    if (user.telegramChatId !== chatId) {
      return NextResponse.json({ ok: true });
    }

    if (text === "/stop") {
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramStatus: "stopped" },
      });
      await sendMessage(
        botToken,
        chatId,
        "🔕 Bildirimler durduruldu. Tekrar açmak için /start yaz ya da web panelden bağlantıyı yenile.",
      );
      return NextResponse.json({ ok: true });
    }

    if (text === "/status") {
      const [productCount, alertCount] = await Promise.all([
        prisma.trackedProduct.count({ where: { userId: user.id, status: "ACTIVE" } }),
        prisma.alertRule.count({ where: { userId: user.id, isActive: true } }),
      ]);

      const statusLabel = user.telegramStatus === "connected" ? "Aktif" : "Durduruldu";

      await sendMessage(
        botToken,
        chatId,
        [
          "📊 <b>CompeteHive Durum</b>",
          "",
          `📦 Aktif takipli ürün: <b>${productCount}</b>`,
          `🔔 Aktif uyarı kuralı: <b>${alertCount}</b>`,
          `🔔 Bildirim durumu: <b>${statusLabel}</b>`,
        ].join("\n"),
      );
      return NextResponse.json({ ok: true });
    }

    if (text === "/test") {
      await sendMessage(
        botToken,
        chatId,
        [
          "🔔 <b>Test bildirimi</b>",
          "",
          "Telegram bağlantın sorunsuz çalışıyor. Gerçek fiyat değişiklikleri bu sohbete bu formatta gelecek.",
        ].join("\n"),
      );
      return NextResponse.json({ ok: true });
    }

    // Unknown command
    await sendMessage(
      botToken,
      chatId,
      "Komutu anlayamadım. Kullanılabilir komutlar: /status /test /stop",
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always 200 — Telegram retries otherwise
    return NextResponse.json({ ok: true });
  }
}
