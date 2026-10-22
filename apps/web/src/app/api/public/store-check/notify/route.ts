import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { apiSuccess, badRequest, notFound, serverError } from "@/lib/api-response";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

const schema = z.object({
  checkId: z.string().uuid("Geçersiz kontrol kaydı"),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta adresi girin").max(254),
});

// POST - "Siteniz desteklendiğinde haber verelim" talebi. Yalnızca henüz
// e-posta bırakılmamış bir kontrol kaydına yazılır (başkasının kaydını
// değiştirmek mümkün olmasın).
export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(`rate:store-check-notify:${clientIp(req)}`, 5, 60 * 60, {
      failClosed: true,
    });
    if (!rl.success) return rateLimitResponse(rl.reset);

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Geçersiz istek");

    const { count } = await prisma.storeCheck.updateMany({
      where: { id: parsed.data.checkId, email: null },
      data: { email: parsed.data.email },
    });
    if (count === 0) return notFound("Kontrol kaydı bulunamadı");

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "POST /api/public/store-check/notify error");
  }
}
