import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import prisma from "@/lib/prisma";
import { cleanOwnStoreNames, updateOwnStoreNamesSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// GET /api/account/store-names - Kullanıcının kendi mağaza adları
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { ownStoreNames: true },
  });

  return NextResponse.json({ storeNames: row?.ownStoreNames ?? [] });
}

// PUT /api/account/store-names - Mağaza adlarını kaydet (listenin tamamı)
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  const parsed = updateOwnStoreNamesSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Geçersiz mağaza adı";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { ownStoreNames: cleanOwnStoreNames(parsed.data.storeNames) },
    select: { ownStoreNames: true },
  });

  return NextResponse.json({ storeNames: updated.ownStoreNames });
}
