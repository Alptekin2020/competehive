import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

// ============================================
// DELETE /api/products/[id]/competitors/[competitorId] — Rakip kaydını sil
// ============================================
//
// Yanlış eşleşen bir rakip, kalite politikasına takılsa bile listede gürültü
// yaratır ve kullanıcının veriye güvenini bozar; üstelik keşif hattı kabul
// edilmiş URL'leri yeniden doğrulamadığı için kayıt kendiliğinden düzelmez.
// Bu uç kullanıcıya son sözü verir. Fiyat geçmişi (CompetitorPrice) şemadaki
// onDelete: Cascade ile birlikte silinir. Otomatik keşif aynı URL'yi ileride
// yeniden bulabilir — kalıcı "reddedildi" işareti ayrı bir şema değişikliği
// gerektirir ve bilinçli olarak bu kapsamın dışındadır.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; competitorId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id, competitorId } = await params;

    const competitor = await prisma.competitor.findFirst({
      where: {
        id: competitorId,
        trackedProductId: id,
        trackedProduct: { userId: user.id },
      },
      select: { id: true },
    });
    if (!competitor) return notFound("Rakip bulunamadı");

    await prisma.competitor.delete({ where: { id: competitor.id } });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/products/[id]/competitors/[competitorId] error");
  }
}
