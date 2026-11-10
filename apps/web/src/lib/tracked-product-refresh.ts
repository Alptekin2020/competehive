import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

type RefreshData = {
  refreshStatus?: string | null;
  refreshRequestedAt?: Date | null;
  refreshCompletedAt?: Date | null;
  refreshError?: string | null;
};

const REFRESH_COLUMN_NAMES = [
  "tracked_products.refresh_status",
  "tracked_products.refresh_requested_at",
  "tracked_products.refresh_completed_at",
  "tracked_products.refresh_error",
];

function isMissingRefreshColumnError(error: unknown): boolean {
  const prismaError = error instanceof PrismaClientKnownRequestError ? error : undefined;
  const message = error instanceof Error ? error.message : "";
  const target = `${prismaError?.meta?.target ?? ""}`;

  return (
    prismaError?.code === "P2022" &&
    REFRESH_COLUMN_NAMES.some((column) => message.includes(column) || target.includes(column))
  );
}

export async function updateTrackedProductRefresh(
  productId: string,
  refreshData: RefreshData,
  fallbackData?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.trackedProduct.update({
      where: { id: productId },
      data: refreshData,
    });
  } catch (error) {
    if (!isMissingRefreshColumnError(error)) {
      throw error;
    }

    logger.warn(
      { productId, refreshData, err: error },
      "TrackedProduct refresh columns missing in DB, retrying update without refresh fields",
    );

    if (fallbackData) {
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: fallbackData as never,
      });
    }
  }
}

// ============================================
// Takılı kalan yenileme istekleri
// ============================================
//
// "pending"/"processing" durumunu yalnızca worker kapatır. İş kuyrukta
// işlenmezse (worker kapalı, iş kayboldu) durum sonsuza dek açık kalıyordu:
// "Fiyatları Yenile" kilitli, sayfa 3 sn'de bir sorgu atıyor, yeni istek 429
// alıyordu. Bu süreden uzun süredir ilerlemeyen istek zaman aşımına uğramış
// sayılır; normal bir yenileme birkaç dakikayı geçmez.
export const REFRESH_STALE_AFTER_MS = 10 * 60 * 1000;

export const REFRESH_TIMEOUT_MESSAGE = "Yenileme zaman aşımına uğradı. Lütfen tekrar deneyin.";

/**
 * Açık görünen bir yenileme isteği takılmış mı? İlerleme göstergesi olarak
 * isteğin zamanı ile satırın son güncellenme zamanından yeni olanı alınır
 * (worker "processing"e geçerken satırı günceller).
 */
export function isRefreshStale(
  product: {
    refreshStatus: string | null;
    refreshRequestedAt: Date | null;
    updatedAt: Date;
  },
  now: Date = new Date(),
): boolean {
  if (product.refreshStatus !== "pending" && product.refreshStatus !== "processing") return false;
  const lastProgressAt = Math.max(
    product.refreshRequestedAt?.getTime() ?? 0,
    product.updatedAt.getTime(),
  );
  return now.getTime() - lastProgressAt > REFRESH_STALE_AFTER_MS;
}
