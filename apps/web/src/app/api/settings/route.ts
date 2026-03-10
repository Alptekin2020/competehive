import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import pool from "@/lib/db-pool";

// GET /api/settings - Kullanıcı ayarlarını getir
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query(
      `SELECT email, name, plan, max_products, telegram_chat_id, webhook_url, is_active
       FROM users WHERE clerk_id = $1`,
      [user.clerkId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      email: row.email,
      name: row.name,
      plan: row.plan,
      maxProducts: row.max_products,
      telegramChatId: row.telegram_chat_id,
      webhookUrl: row.webhook_url,
      isActive: row.is_active,
    });
  } catch (error: any) {
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
          { status: 400 }
        );
      }
    }

    // Validate webhook URL if provided
    if (webhookUrl !== undefined && webhookUrl !== null && webhookUrl !== "") {
      try {
        new URL(webhookUrl);
      } catch {
        return NextResponse.json(
          { error: "Geçersiz webhook URL formatı." },
          { status: 400 }
        );
      }
    }

    const result = await pool.query(
      `UPDATE users
       SET telegram_chat_id = $1,
           webhook_url = $2,
           updated_at = NOW()
       WHERE clerk_id = $3
       RETURNING email, name, plan, max_products, telegram_chat_id, webhook_url`,
      [
        telegramChatId || null,
        webhookUrl || null,
        user.clerkId,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      telegramChatId: row.telegram_chat_id,
      webhookUrl: row.webhook_url,
    });
  } catch (error: any) {
    console.error("PUT /api/settings error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
