import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { Prisma } from "@prisma/client";
import { apiSuccess, unauthorized, notFound, badRequest, serverError } from "@/lib/api-response";
import {
  addRejectedCompetitorUrl,
  USER_CONFIRMED_REASON,
  USER_CONFIRMED_SCORE,
  withMatchReview,
} from "@/lib/match-review";

// ============================================
// DELETE /api/products/[id]/competitors/[competitorId] — Rakip kaydını sil
// ============================================
//
// Yanlış eşleşen bir rakip, kalite politikasına takılsa bile listede gürültü
// yaratır ve kullanıcının veriye güvenini bozar; üstelik keşif hattı kabul
// edilmiş URL'leri yeniden doğrulamadığı için kayıt kendiliğinden düzelmez.
// Bu uç kullanıcıya son sözü verir. Fiyat geçmişi (CompetitorPrice) şemadaki
// onDelete: Cascade ile birlikte silinir. Silinen URL ürünün
// metadata.rejectedCompetitorUrls listesine yazılır; worker keşfi bu listedeki
// URL'leri bir daha getirmez (kullanıcı aynı yanlış eşleşmeyi tekrar tekrar
// silmek zorunda kalmaz).

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
      select: {
        id: true,
        competitorUrl: true,
        trackedProduct: { select: { metadata: true } },
      },
    });
    if (!competitor) return notFound("Rakip bulunamadı");

    await prisma.$transaction([
      prisma.competitor.delete({ where: { id: competitor.id } }),
      prisma.trackedProduct.update({
        where: { id },
        data: {
          metadata: addRejectedCompetitorUrl(
            competitor.trackedProduct.metadata,
            competitor.competitorUrl,
          ) as Prisma.InputJsonValue,
        },
      }),
    ]);

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/products/[id]/competitors/[competitorId] error");
  }
}

// ============================================
// PATCH /api/products/[id]/competitors/[competitorId] — "Bu aynı ürün" onayı
// ============================================
//
// AI'ın emin olamadığı (skor < 70) eşleşmeler karar hesaplarına girmez. Satıcı
// ürününü AI'dan iyi tanır: onay, skoru 100 yapar ve kaydı pozisyon, fiyat
// önerisi ve alarmlara dahil eder. Worker onaylı kayıtların skorunu düşürmez.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; competitorId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Geçersiz istek gövdesi");
    }
    if ((body as { action?: unknown } | null)?.action !== "confirm") {
      return badRequest("Geçersiz işlem");
    }

    const { id, competitorId } = await params;

    const competitor = await prisma.competitor.findFirst({
      where: {
        id: competitorId,
        trackedProductId: id,
        trackedProduct: { userId: user.id },
      },
      select: { id: true, matchAttributes: true },
    });
    if (!competitor) return notFound("Rakip bulunamadı");

    const updated = await prisma.competitor.update({
      where: { id: competitor.id },
      data: {
        matchScore: USER_CONFIRMED_SCORE,
        matchReason: USER_CONFIRMED_REASON,
        matchAttributes: withMatchReview(
          competitor.matchAttributes,
          "confirmed",
        ) as Prisma.InputJsonValue,
      },
      select: { id: true, matchScore: true, matchReason: true },
    });

    return apiSuccess({ success: true, competitor: { ...updated, review: "confirmed" } });
  } catch (error) {
    return serverError(error, "PATCH /api/products/[id]/competitors/[competitorId] error");
  }
}
