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
