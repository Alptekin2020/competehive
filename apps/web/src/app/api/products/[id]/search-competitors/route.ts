import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { addCompetitorSearchJob } from "@/lib/queue";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401 });

  // Each search enqueues a Serper-backed discovery job (paid per call), so
  // throttle per user to keep a stuck/abused button from running up cost.
  const rl = await rateLimit(`rate:compsearch:${user.id}`, 5, 300);
  if (!rl.success) return rateLimitResponse(rl.reset);

  const { id } = await params;
  const product = await prisma.trackedProduct.findFirst({
    where: { id, userId: user.id },
  });

  if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });

  try {
    await addCompetitorSearchJob(
      product.id,
      product.productName || product.productUrl,
      product.marketplace,
    );
    return NextResponse.json({ success: true, message: "Rakip arama başlatıldı" });
  } catch (error) {
    console.error("Queue error:", error);
    return NextResponse.json({ error: "Kuyruk hatası" }, { status: 500 });
  }
}
