import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

// PUT /api/products/[id]/tags — set tags for a product (replaces all)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  try {
    const { id: productId } = await params;

    // Verify product belongs to user
    const product = await prisma.trackedProduct.findFirst({
      where: { id: productId, userId: user.id },
    });
    if (!product) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
    }

    const body = await req.json();
    const tagIds: string[] = body.tagIds || [];

    // Verify all tags belong to this user
    if (tagIds.length > 0) {
      const validTags = await prisma.tag.count({
        where: { id: { in: tagIds }, userId: user.id },
      });
      if (validTags !== tagIds.length) {
        return NextResponse.json({ error: "Geçersiz etiket" }, { status: 400 });
      }
    }

    // Remove all existing tags for this product, then add new ones
    await prisma.productTag.deleteMany({ where: { productId } });

    if (tagIds.length > 0) {
      await prisma.productTag.createMany({
        data: tagIds.map((tagId) => ({ productId, tagId })),
      });
    }

    return NextResponse.json({ success: true, tagIds });
  } catch (error) {
    console.error("Set product tags error:", error);
    return NextResponse.json({ error: "Etiketler güncellenemedi" }, { status: 500 });
  }
}
