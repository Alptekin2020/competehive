import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { addCompetitorSearchJob } from "@/lib/queue";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401 });

  const product = await prisma.trackedProduct.findFirst({
    where: { id: params.id, userId: user.id },
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
