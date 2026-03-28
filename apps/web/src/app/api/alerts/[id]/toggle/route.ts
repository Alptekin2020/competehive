import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const rule = await prisma.alertRule.findFirst({
      where: { id, userId: user.id },
    });

    if (!rule) return notFound("Kural bulunamadı");

    const updated = await prisma.alertRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });

    return apiSuccess({ success: true, rule: updated });
  } catch (error) {
    return serverError(error, "PATCH /api/alerts/[id]/toggle error");
  }
}
