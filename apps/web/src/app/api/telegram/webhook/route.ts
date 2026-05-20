import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
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
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!expectedSecret || !botToken) {
      console.error("Telegram env vars not set");
      return NextResponse.json({ ok: true });
    }

    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== expectedSecret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update: TelegramUpdate = await req.json();
    const message = update.message;
    if (!message?.text || message.chat.type !== "private") {
      return NextResponse.json({ ok: true });
    }

    const text = message.text.trim();
    const chatId = String(message.chat.id);

    // /start [token]
    const startMatch = text.match(/^\/start(?:\s+(\S+))?$/);
    if (startMatch) {
      const linkToken = startMatch[1];

      if (linkToken) {
        // First-time connection via deep link
        const user = await prisma.user.findUnique({
          where: { telegramLinkToken: linkToken },
          select: {
            id: true,
            telegramLinkTokenExpiresAt: true,
            telegramChatId: true,
          },
        });

        if (!user) {
          await sendMessage(
            botToken,
            chatId,
            "❌ Geçersiz bağlantı kodu. CompeteHive'da Ayarlar sayfasından yeni bir bağlantı linki oluştur.",
          );
          return NextResponse.json({ ok: true });
        }

        if (
          !user.telegramLinkTokenExpiresAt ||
          user.telegramLinkTokenExpiresAt.getTime() < Date.now()
        ) {
          await sendMessage(
            botToken,
            chatId,
            "⏱️ Bağlantı kodu süresi dolmuş. CompeteHive'da Ayarlar sayfasından yeni bir link oluştur.",
          );
          return NextResponse.json({ ok: true });
        }

        // First-wins: bu user'a daha önce chat_id atanmışsa override etmiyoruz
        if (user.telegramChatId && user.telegramChatId !== chatId) {
          await sendMessage(
            botToken,
            chatId,
            "❌ Bu hesap başka bir Telegram kullanıcısına bağlı. Mevcut bağlantıyı CompeteHive Ayarlar sayfasından kaldırıp tekrar dene.",
          );
          return NextResponse.json({ ok: true });
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            telegramChatId: chatId,
            telegramStatus: "connected",
            telegramConnectedAt: new Date(),
            telegramLinkToken: null,
            telegramLinkTokenExpiresAt: null,
          },
        });

        await sendMessage(
          botToken,
          chatId,
          [
            "✅ <b>CompeteHive bildirimleri aktif!</b>",
            "",
            "Artık takip ettiğin ürünlerdeki fiyat değişikliklerini ve stok hareketlerini anında buradan göreceksin.",
            "",
            "<b>Komutlar:</b>",
            "/status — Aktif takip durumu",
            "/test — Test bildirimi gönder",
            "/stop — Bildirimleri durdur",
          ].join("\n"),
        );
        return NextResponse.json({ ok: true });
      }

      // /start without token → returning user
      const existing = await prisma.user.findFirst({
        where: { telegramChatId: chatId },
        select: { id: true, telegramStatus: true },
      });

      if (!existing) {
        await sendMessage(
          botToken,
          chatId,
          "👋 Merhaba! CompeteHive bildirimlerini almak için Ayarlar sayfasından bağlantı linki oluştur:\nhttps://competehive.com/dashboard/settings",
        );
        return NextResponse.json({ ok: true });
      }

      if (existing.telegramStatus === "stopped") {
        await prisma.user.update({
          where: { id: existing.id },
          data: { telegramStatus: "connected" },
        });
        await sendMessage(botToken, chatId, "✅ Bildirimler yeniden aktifleştirildi.");
      } else {
        await sendMessage(
          botToken,
          chatId,
          "✅ Zaten bağlısın. Bildirimler buraya gelmeye devam ediyor.",
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Diğer komutlar — chat_id ile user bul
    const user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
      select: { id: true, telegramStatus: true },
    });

    if (!user) {
      await sendMessage(
        botToken,
        chatId,
        "Bu sohbet bir CompeteHive hesabına bağlı değil. Ayarlar'dan bağlantı linki oluştur:\nhttps://competehive.com/dashboard/settings",
      );
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
        "🔕 Bildirimler durduruldu. Tekrar açmak için /start yaz.",
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
          "Telegram bağlantın sorunsuz çalışıyor. Gerçek fiyat değişiklikleri bu formatta gelecek.",
        ].join("\n"),
      );
      return NextResponse.json({ ok: true });
    }

    await sendMessage(
      botToken,
      chatId,
      "Komutu anlayamadım. Kullanılabilir komutlar: /status /test /stop",
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
