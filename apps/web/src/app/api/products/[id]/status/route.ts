import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

import { NextRequest } from "next/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
      select: {
        refreshStatus: true,
        refreshRequestedAt: true,
        refreshCompletedAt: true,
        refreshError: true,
        updatedAt: true,
      },
    });

    if (!product) return notFound("Ürün bulunamadı");

    return apiSuccess({
      refreshStatus: product.refreshStatus,
      refreshRequestedAt: product.refreshRequestedAt,
      refreshCompletedAt: product.refreshCompletedAt,
      refreshError: product.refreshError,
      updatedAt: product.updatedAt,
    });
  } catch (error) {
    return serverError(error, "Status check failed");
  }
}
