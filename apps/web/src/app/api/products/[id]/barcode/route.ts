import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, badRequest, serverError } from "@/lib/api-response";
import { updateBarcodeSchema } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addCompetitorSearchJob } from "@/lib/queue";
import { applyBarcodeToMetadata } from "@/lib/product-barcode";
import { logger } from "@/lib/logger";

// Takipteki ürünün barkodunu kaydeder. Yeni bir barkod girilince rakipler
// hemen yeniden aranır: worker barkodla ayrıca arar ve aynı barkodu taşıyan
// ilanları doğrudan eşleştirir; onay bekleyen adaylar da barkodla yeniden
// değerlendirilir. Her kayıt ücretli bir keşif turu açabildiği için sınırlı.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rl = await rateLimit(`rate:barcode:${user.id}`, 10, 3600, { failClosed: true });
    if (!rl.success) return rateLimitResponse(rl.reset);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateBarcodeSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
      select: { id: true, productName: true, productUrl: true, marketplace: true, metadata: true },
    });
    if (!product) return notFound("Ürün bulunamadı");

    const update = applyBarcodeToMetadata(product.metadata, parsed.data.gtin);
    if (update.changed) {
      await prisma.trackedProduct.update({
        where: { id: product.id },
        data: { metadata: update.metadata as Prisma.InputJsonValue },
      });
    }

    let searchStarted = false;
    if (update.shouldSearch) {
      try {
        await addCompetitorSearchJob(
          product.id,
          product.productName || product.productUrl,
          product.marketplace,
        );
        searchStarted = true;
      } catch (err) {
        // Barkod kaydedildi; arama bir sonraki periyodik keşif turunda yapılır.
        logger.error({ err, productId: product.id }, "Barcode competitor search enqueue failed");
      }
    }

    logger.info(
      { productId: product.id, changed: update.changed, searchStarted },
      "Product barcode updated",
    );

    return apiSuccess({
      success: true,
      gtin: parsed.data.gtin,
      changed: update.changed,
      searchStarted,
      replacedListingGtin: update.replacedListingGtin,
    });
  } catch (error) {
    return serverError(error, "Product barcode update failed");
  }
}
