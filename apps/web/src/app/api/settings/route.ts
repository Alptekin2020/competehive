import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";

// GET /api/settings - Kullanıcı ayarlarını getir
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
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
      return notFound("Kullanıcı bulunamadı");
    }

    return apiSuccess({
      email: dbUser.email,
      name: dbUser.name,
      plan: dbUser.plan,
      maxProducts: dbUser.maxProducts,
      telegramChatId: dbUser.telegramChatId,
      webhookUrl: dbUser.webhookUrl,
      isActive: dbUser.isActive,
    });
  } catch (error) {
    return serverError(error, "GET /api/settings");
  }
}

// PUT /api/settings - Kullanıcı ayarlarını güncelle
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const body = await req.json();
    const { telegramChatId, webhookUrl } = body;

    // Validate telegram chat ID format if provided
    if (telegramChatId !== undefined && telegramChatId !== null && telegramChatId !== "") {
      const chatId = String(telegramChatId).trim();
      if (chatId && !/^-?\d+$/.test(chatId)) {
        return badRequest("Geçersiz Telegram Chat ID formatı. Sayısal bir değer olmalıdır.");
      }
    }

    // Validate webhook URL if provided
    if (webhookUrl !== undefined && webhookUrl !== null && webhookUrl !== "") {
      try {
        new URL(webhookUrl);
      } catch {
        return badRequest("Geçersiz webhook URL formatı.");
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

    return apiSuccess({
      success: true,
      telegramChatId: updated.telegramChatId,
      webhookUrl: updated.webhookUrl,
    });
  } catch (error) {
    return serverError(error, "PUT /api/settings");
  }
}
