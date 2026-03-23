import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getProductQueue } from "@/lib/queue";
import { unauthorized, notFound, serverError } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id: productId } = await params;

    const product = await prisma.trackedProduct.findFirst({
      where: { id: productId, userId: user.id },
    });

    if (!product) return notFound("Ürün bulunamadı");

    // Prevent spam: if there's already a pending/processing refresh, reject
    if (product.refreshStatus === "pending" || product.refreshStatus === "processing") {
      return NextResponse.json(
        { error: "Bu ürün için zaten bir yenileme işlemi devam ediyor" },
        { status: 429 },
      );
    }

    // Update product status to pending
    await prisma.trackedProduct.update({
      where: { id: productId },
      data: {
        refreshStatus: "pending",
        refreshRequestedAt: new Date(),
        refreshCompletedAt: null,
        refreshError: null,
      },
    });

    // Add job to BullMQ queue
    const queue = getProductQueue();
    await queue.add(
      "refresh",
      {
        productId,
        manual: true,
      },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        jobId: `manual-refresh-${productId}-${Date.now()}`,
      },
    );

    return NextResponse.json({
      success: true,
      message: "Yenileme işlemi başlatıldı",
      refreshStatus: "pending",
    });
  } catch (error) {
    return serverError(error, "Refresh trigger failed");
  }
}
