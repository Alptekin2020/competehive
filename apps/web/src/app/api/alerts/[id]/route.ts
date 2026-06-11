import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";
import { getPlanFeatures } from "@/lib/plan-gates";

// ============================================
// PATCH /api/alerts/[id] - Uyarı kuralını düzenle
// ============================================
//
// Yalnızca davranış alanları düzenlenebilir: eşik, yön, kanallar, bekleme
// süresi, aktiflik. ruleType ve kapsam (trackedProductId) bilinçli olarak
// kilitli — tür/kapsam değişikliği yeni bir kural anlamına gelir ve genel
// kural ezme semantiğini sessizce bozabilirdi.

const updateAlertSchema = z
  .object({
    thresholdValue: z.number().nullable().optional(),
    direction: z.enum(["above", "below"]).nullable().optional(),
    notifyVia: z
      .array(z.enum(["EMAIL", "TELEGRAM", "WEBHOOK"]))
      .min(1)
      .optional(),
    cooldownMinutes: z.number().min(5).max(1440).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Güncellenecek alan yok",
  });

const THRESHOLD_REQUIRED_TYPES = new Set(["PRICE_THRESHOLD", "PERCENTAGE_CHANGE"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const rule = await prisma.alertRule.findFirst({
      where: { id, userId: user.id },
    });
    if (!rule) return notFound("Kural bulunamadı");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Geçersiz istek gövdesi");
    }
    const parsed = updateAlertSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0].message);
    }

    // Eşik gerektiren kural türlerinde eşik silinemez.
    if (
      THRESHOLD_REQUIRED_TYPES.has(rule.ruleType) &&
      "thresholdValue" in parsed.data &&
      parsed.data.thresholdValue == null
    ) {
      return badRequest("Bu kural türü için eşik değeri zorunludur.");
    }

    // Kanal değişikliği plan kapısından geçer (POST ile aynı kural).
    if (parsed.data.notifyVia) {
      const features = getPlanFeatures(user.plan);
      const disallowed = parsed.data.notifyVia.filter(
        (ch) => !features.allowedChannels.includes(ch),
      );
      if (disallowed.length > 0) {
        const names: Record<string, string> = { TELEGRAM: "Telegram", WEBHOOK: "Webhook" };
        return new Response(
          JSON.stringify({
            error: `${disallowed.map((c) => names[c] || c).join(", ")} bildirimi mevcut planınızda kullanılamaz. Planınızı yükseltin.`,
            upgradeRequired: true,
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const updated = await prisma.alertRule.update({
      where: { id },
      data: {
        ...(parsed.data.thresholdValue !== undefined
          ? { thresholdValue: parsed.data.thresholdValue }
          : {}),
        ...(parsed.data.direction !== undefined ? { direction: parsed.data.direction } : {}),
        ...(parsed.data.notifyVia !== undefined ? { notifyVia: parsed.data.notifyVia } : {}),
        ...(parsed.data.cooldownMinutes !== undefined
          ? { cooldownMinutes: parsed.data.cooldownMinutes }
          : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      },
    });

    return apiSuccess({ success: true, rule: updated });
  } catch (error) {
    return serverError(error, "PATCH /api/alerts/[id] error");
  }
}
