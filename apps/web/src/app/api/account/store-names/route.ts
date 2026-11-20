import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { cleanOwnStores, parseOwnStores } from "@/lib/own-stores";
import prisma from "@/lib/prisma";
import { cleanOwnStoreNames, updateOwnStoresSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const SELECT = { ownStores: true, ownStoreNames: true } as const;

function toResponse(row: { ownStores: unknown; ownStoreNames: string[] } | null) {
  return {
    // Pazaryeri başına mağaza adı: {"TRENDYOL": "…"}.
    stores: parseOwnStores(row?.ownStores),
    // Eski tek liste: adı girilmemiş pazaryerlerinde kullanılır.
    storeNames: row?.ownStoreNames ?? [],
  };
}

// GET /api/account/store-names - Kullanıcının kendi mağaza adları
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: SELECT });
  return NextResponse.json(toResponse(row));
}

// PUT /api/account/store-names - Pazaryeri başına adlar (`stores`, haritanın
// tamamı) ve/veya eski tek liste (`storeNames`, listenin tamamı)
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

  const parsed = updateOwnStoresSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Geçersiz mağaza adı";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(parsed.data.stores !== undefined
        ? { ownStores: cleanOwnStores(parsed.data.stores) }
        : {}),
      ...(parsed.data.storeNames !== undefined
        ? { ownStoreNames: cleanOwnStoreNames(parsed.data.storeNames) }
        : {}),
    },
    select: SELECT,
  });

  return NextResponse.json(toResponse(updated));
}
