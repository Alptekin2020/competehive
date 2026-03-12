import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";

// ============================================
// GET /api/alerts - Kullanıcının uyarı kurallarını listele
// ============================================

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rules = await prisma.alertRule.findMany({
      where: { userId: user.id },
      include: {
        trackedProduct: {
          select: { productName: true, marketplace: true, currentPrice: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return apiSuccess({ rules });
  } catch (error) {
    return serverError(error, "GET /api/alerts error");
  }
}

// ============================================
// POST /api/alerts - Yeni uyarı kuralı oluştur
// ============================================

const createAlertSchema = z.object({
  trackedProductId: z.string().uuid(),
  ruleType: z.enum([
    "PRICE_DROP",
    "PRICE_INCREASE",
    "PRICE_THRESHOLD",
    "PERCENTAGE_CHANGE",
    "COMPETITOR_CHEAPER",
    "OUT_OF_STOCK",
    "BACK_IN_STOCK",
  ]),
  thresholdValue: z.number().optional(),
  direction: z.enum(["above", "below"]).optional(),
  notifyVia: z.array(z.enum(["EMAIL", "TELEGRAM", "WEBHOOK"])).min(1),
  cooldownMinutes: z.number().min(5).max(1440).default(60),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = createAlertSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0].message);
    }

    const product = await prisma.trackedProduct.findFirst({
      where: { id: parsed.data.trackedProductId, userId: user.id },
    });

    if (!product) return notFound("Ürün bulunamadı");

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

    return apiSuccess({ success: true, rule }, 201);
  } catch (error) {
    return serverError(error, "POST /api/alerts error");
  }
}

// ============================================
// DELETE /api/alerts - Uyarı kuralını sil
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const ruleId = searchParams.get("id");

    if (!ruleId) return badRequest("Kural ID gerekli");

    const rule = await prisma.alertRule.findFirst({
      where: { id: ruleId, userId: user.id },
    });

    if (!rule) return notFound("Kural bulunamadı");

    await prisma.alertRule.delete({ where: { id: ruleId } });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/alerts error");
  }
}
