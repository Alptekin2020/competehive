import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";
import {
  REFRESH_TIMEOUT_MESSAGE,
  isRefreshStale,
  updateTrackedProductRefresh,
} from "@/lib/tracked-product-refresh";

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

    // Worker'ın hiç kapatmadığı istek: "failed" olarak kapat ki buton yeniden
    // kullanılabilsin ve istemci sonsuza dek yoklamasın.
    if (isRefreshStale(product)) {
      const completedAt = new Date();
      await updateTrackedProductRefresh(id, {
        refreshStatus: "failed",
        refreshCompletedAt: completedAt,
        refreshError: REFRESH_TIMEOUT_MESSAGE,
      });
      return apiSuccess({
        refreshStatus: "failed",
        refreshRequestedAt: product.refreshRequestedAt,
        refreshCompletedAt: completedAt,
        refreshError: REFRESH_TIMEOUT_MESSAGE,
        updatedAt: completedAt,
      });
    }

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
