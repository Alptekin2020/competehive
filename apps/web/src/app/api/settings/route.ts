import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

// GET /api/settings - Kullanıcı ayarlarını getir
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: {
        email: true,
        name: true,
        plan: true,
        maxProducts: true,
        telegramChatId: true,
        webhookUrl: true,
        isActive: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    return NextResponse.json({
      email: dbUser.email,
      name: dbUser.name,
      plan: dbUser.plan,
      maxProducts: dbUser.maxProducts,
      telegramChatId: dbUser.telegramChatId,
      webhookUrl: dbUser.webhookUrl,
      isActive: dbUser.isActive,
    });
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}

// PUT /api/settings - Kullanıcı ayarlarını güncelle
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { telegramChatId, webhookUrl } = body;

    // Validate telegram chat ID format if provided
    if (telegramChatId !== undefined && telegramChatId !== null && telegramChatId !== "") {
      const chatId = String(telegramChatId).trim();
      if (chatId && !/^-?\d+$/.test(chatId)) {
        return NextResponse.json(
          { error: "Geçersiz Telegram Chat ID formatı. Sayısal bir değer olmalıdır." },
          { status: 400 },
        );
      }
    }

    // Validate webhook URL if provided
    if (webhookUrl !== undefined && webhookUrl !== null && webhookUrl !== "") {
      try {
        new URL(webhookUrl);
      } catch {
        return NextResponse.json({ error: "Geçersiz webhook URL formatı." }, { status: 400 });
      }
    }

    const updated = await prisma.user.update({
      where: { clerkId: user.clerkId },
      data: {
        telegramChatId: telegramChatId || null,
        webhookUrl: webhookUrl || null,
      },
      select: {
        telegramChatId: true,
        webhookUrl: true,
      },
    });

    return NextResponse.json({
      success: true,
      telegramChatId: updated.telegramChatId,
      webhookUrl: updated.webhookUrl,
    });
  } catch (error) {
    console.error("PUT /api/settings error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
