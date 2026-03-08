import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";

// ============================================
// GET /api/alerts - Kullanıcının uyarı kurallarını listele
// ============================================

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await prisma.alertRule.findMany({
    where: { userId: user.id },
    include: {
      trackedProduct: {
        select: { productName: true, marketplace: true, currentPrice: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ rules });
}

// ============================================
// POST /api/alerts - Yeni uyarı kuralı oluştur
// ============================================

const createAlertSchema = z.object({
  trackedProductId: z.string().uuid(),
  ruleType: z.enum([
    "PRICE_DROP", "PRICE_INCREASE", "PRICE_THRESHOLD",
    "PERCENTAGE_CHANGE", "COMPETITOR_CHEAPER", "OUT_OF_STOCK", "BACK_IN_STOCK",
  ]),
  thresholdValue: z.number().optional(),
  direction: z.enum(["above", "below"]).optional(),
  notifyVia: z.array(z.enum(["EMAIL", "TELEGRAM", "WEBHOOK"])).min(1),
  cooldownMinutes: z.number().min(5).max(1440).default(60),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createAlertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const product = await prisma.trackedProduct.findFirst({
      where: { id: parsed.data.trackedProductId, userId: user.id },
    });

    if (!product) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
    }

    const rule = await prisma.alertRule.create({
      data: {
        userId: user.id,
        trackedProductId: parsed.data.trackedProductId,
        ruleType: parsed.data.ruleType,
        thresholdValue: parsed.data.thresholdValue,
        direction: parsed.data.direction,
        notifyVia: parsed.data.notifyVia,
        cooldownMinutes: parsed.data.cooldownMinutes,
      },
    });

    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (error) {
    console.error("Create alert error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}

// ============================================
// DELETE /api/alerts - Uyarı kuralını sil
// ============================================

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const ruleId = searchParams.get("id");

  if (!ruleId) {
    return NextResponse.json({ error: "Kural ID gerekli" }, { status: 400 });
  }

  const rule = await prisma.alertRule.findFirst({
    where: { id: ruleId, userId: user.id },
  });

  if (!rule) {
    return NextResponse.json({ error: "Kural bulunamadı" }, { status: 404 });
  }

  await prisma.alertRule.delete({ where: { id: ruleId } });

  return NextResponse.json({ success: true });
}
