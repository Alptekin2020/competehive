import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
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
      return notFound("Ürün bulunamadı");
    }

    return apiSuccess({ product });
  } catch (error) {
    return serverError(error, "Product detail fetch failed");
  }
}
