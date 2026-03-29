import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { z } from "zod";
import { getPlanFeatures } from "@/lib/plan-gates";

// GET /api/tags — list user's tags with product counts
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const tags = await prisma.tag.findMany({
    where: { userId: user.id },
    include: {
      _count: { select: { products: true } },
    },
    orderBy: { name: "asc" },
  });

  const result = tags.map((tag) => ({
    ...tag,
    productCount: tag._count.products,
  }));

  return NextResponse.json({ tags: result });
}

// POST /api/tags — create a new tag
const createTagSchema = z.object({
  name: z.string().min(1, "Etiket adı gerekli").max(30, "Etiket adı en fazla 30 karakter"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Geçerli renk kodu gerekli")
    .optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createTagSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    // Plan-based tag system check
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true },
    });
    const features = getPlanFeatures(userRecord?.plan || "FREE");

    if (!features.hasTagSystem) {
      return NextResponse.json(
        {
          error: "Etiketleme sistemi Başlangıç ve üzeri planlarda kullanılabilir.",
          upgradeRequired: true,
        },
        { status: 403 },
      );
    }

    // Check for duplicate name
    const existing = await prisma.tag.findUnique({
      where: { userId_name: { userId: user.id, name: parsed.data.name } },
    });
    if (existing) {
      return NextResponse.json({ error: "Bu etiket adı zaten mevcut" }, { status: 409 });
    }

    // Plan-based tag limit
    const tagCount = await prisma.tag.count({ where: { userId: user.id } });
    if (tagCount >= features.maxTags) {
      return NextResponse.json(
        { error: `Mevcut planınızla en fazla ${features.maxTags} etiket oluşturabilirsiniz.` },
        { status: 403 },
      );
    }

    const tag = await prisma.tag.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        color: parsed.data.color || "#F59E0B",
      },
    });

    return NextResponse.json({ success: true, tag }, { status: 201 });
  } catch (error) {
    console.error("Create tag error:", error);
    return NextResponse.json({ error: "Etiket oluşturulamadı" }, { status: 500 });
  }
}

// DELETE /api/tags?id=xxx — delete a tag
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tagId = searchParams.get("id");
  if (!tagId) {
    return NextResponse.json({ error: "Etiket ID gerekli" }, { status: 400 });
  }

  const tag = await prisma.tag.findFirst({
    where: { id: tagId, userId: user.id },
  });
  if (!tag) {
    return NextResponse.json({ error: "Etiket bulunamadı" }, { status: 404 });
  }

  await prisma.tag.delete({ where: { id: tagId } });
  return NextResponse.json({ success: true });
}
