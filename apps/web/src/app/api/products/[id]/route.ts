import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const product = await prisma.trackedProduct.findFirst({
    where: { id: params.id, userId },
    include: {
      competitors: {
        orderBy: { currentPrice: "asc" },
      },
      priceHistory: {
        where: { scrapedAt: { gte: thirtyDaysAgo } },
        orderBy: { scrapedAt: "asc" },
      },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({ product });
}
