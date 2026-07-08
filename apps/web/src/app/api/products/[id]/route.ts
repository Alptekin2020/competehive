import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, notFound, badRequest, serverError } from "@/lib/api-response";
import { getEffectiveFeatures } from "@/lib/plan-gates";
import { updateProductSchema } from "@/lib/validation";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    // Fiyat geçmişi penceresi plana göre belirlenir (FREE 7 gün / STARTER 30 /
    // PRO 365 / ENTERPRISE sınırsız). Önceden herkes için 30 gün sabitti: FREE,
    // 7 günlük hakkının 4 katını görüyor; PRO, ödediği 1 yıllık geçmişi hiçbir
    // yerde göremiyordu. Worker'daki retention işi de aynı süreleri uygular.
    const features = getEffectiveFeatures(user);
    const historyWindowStart =
      features.priceHistoryDays >= 99999
        ? new Date(0)
        : new Date(Date.now() - features.priceHistoryDays * 24 * 60 * 60 * 1000);

    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        productName: true,
        marketplace: true,
        productUrl: true,
        productImage: true,
        currentPrice: true,
        cost: true,
        currency: true,
        status: true,
        refreshStatus: true,
        refreshRequestedAt: true,
        refreshCompletedAt: true,
        refreshError: true,
        lastScrapedAt: true,
        competitors: {
          orderBy: { currentPrice: "asc" },
          select: {
            id: true,
            competitorUrl: true,
            competitorName: true,
            marketplace: true,
            currentPrice: true,
            lastScrapedAt: true,
            matchScore: true,
            matchReason: true,
          },
        },
        priceHistory: {
          where: { scrapedAt: { gte: historyWindowStart } },
          orderBy: { scrapedAt: "asc" },
          select: {
            id: true,
            trackedProductId: true,
            price: true,
            previousPrice: true,
            currency: true,
            priceChange: true,
            priceChangePct: true,
            inStock: true,
            sellerName: true,
            scrapedAt: true,
          },
        },
      },
    });

    if (!product) {
      return notFound("Ürün bulunamadı");
    }

    const responseProduct = {
      id: product.id,
      productName: product.productName,
      marketplace: product.marketplace,
      productUrl: product.productUrl,
      productImage: product.productImage,
      currentPrice: product.currentPrice,
      cost: product.cost,
      currency: product.currency,
      status: product.status,
      refreshStatus: product.refreshStatus,
      refreshRequestedAt: product.refreshRequestedAt,
      refreshCompletedAt: product.refreshCompletedAt,
      refreshError: product.refreshError,
      lastScrapedAt: product.lastScrapedAt,
      priceHistory: product.priceHistory.map(
        (entry: {
          id: bigint;
          trackedProductId: string;
          price: unknown;
          previousPrice: unknown;
          currency: string;
          priceChange: unknown;
          priceChangePct: unknown;
          inStock: boolean;
          sellerName: string | null;
          scrapedAt: Date;
        }) => ({
          id: entry.id.toString(),
          trackedProductId: entry.trackedProductId,
          price: entry.price,
          previousPrice: entry.previousPrice,
          currency: entry.currency,
          priceChange: entry.priceChange,
          priceChangePct: entry.priceChangePct,
          inStock: entry.inStock,
          sellerName: entry.sellerName,
          scrapedAt: entry.scrapedAt,
        }),
      ),
      competitors: product.competitors.map(
        (competitor: {
          id: string;
          competitorUrl: string;
          competitorName: string | null;
          marketplace: unknown;
          currentPrice: unknown;
          lastScrapedAt: Date | null;
          matchScore: number | null;
          matchReason: string | null;
        }) => ({
          id: competitor.id,
          competitorUrl: competitor.competitorUrl,
          competitorName: competitor.competitorName,
          marketplace: competitor.marketplace,
          currentPrice: competitor.currentPrice,
          lastScrapedAt: competitor.lastScrapedAt,
          matchScore: competitor.matchScore,
          matchReason: competitor.matchReason,
        }),
      ),
    };

    return apiSuccess({ product: responseProduct });
  } catch (error) {
    return serverError(error, "Product detail fetch failed");
  }
}

// PATCH - Ürünün satıcı tarafından girilen alanlarını güncelle: maliyet ve/veya
// elle girilen kendi satış fiyatı. Maliyet kâr/marj hesaplarını ve LOW_MARGIN
// uyarısını besler (null = temizle). ownPrice, scraper'ın fiyatı hiç alamadığı
// ürünlerde (Trendyol'un Railway IP engeli — Philips Airfryer vakası) pozisyon
// ve öneri hesaplarını çalıştırmak için kullanıcının girdiği fiyattır.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateProductSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    // Sahiplik kontrolü + elle fiyat girişinin geçmiş satırı için para birimi.
    const product = await prisma.trackedProduct.findFirst({
      where: { id, userId: user.id },
      select: { id: true, currency: true, status: true },
    });
    if (!product) return notFound("Ürün bulunamadı");

    const data: { cost?: number | null; currentPrice?: number; lastScrapedAt?: Date } = {};
    if (parsed.data.cost !== undefined) data.cost = parsed.data.cost;
    if (parsed.data.ownPrice !== undefined) {
      data.currentPrice = parsed.data.ownPrice;
      data.lastScrapedAt = new Date();
    }

    // Elle fiyatta PriceHistory satırı da yazılır: tazelik rozetleri
    // (last_success_at) ve grafik de dolsun. Sonraki başarılı scrape değeri
    // normal akışta günceller — elle giriş kalıcı bir kilit değildir.
    await prisma.$transaction(async (tx) => {
      await tx.trackedProduct.update({ where: { id: product.id }, data });
      if (parsed.data.ownPrice !== undefined) {
        await tx.priceHistory.create({
          data: {
            trackedProductId: product.id,
            price: parsed.data.ownPrice,
            currency: product.currency,
            inStock: product.status !== "OUT_OF_STOCK",
            sellerName: "Elle girildi",
            scrapedAt: new Date(),
          },
        });
      }
    });

    return apiSuccess({
      success: true,
      cost: parsed.data.cost ?? null,
      ownPrice: parsed.data.ownPrice ?? null,
    });
  } catch (error) {
    return serverError(error, "Product update failed");
  }
}
