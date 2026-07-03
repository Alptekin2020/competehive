import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { detectMarketplaceFromUrl, isScraperSupportedMarketplace } from "@/lib/marketplaces";
import { apiSuccess, unauthorized, badRequest, forbidden, serverError } from "@/lib/api-response";
import { z } from "zod";
import { Marketplace } from "@prisma/client";
import { getEffectiveFeatures } from "@/lib/plan-gates";
import { applyRateLimit } from "@/lib/with-rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { addScrapeJob } from "@/lib/queue";
import { ensureDefaultGlobalAlertRules } from "@/lib/default-alerts";
import { logger } from "@/lib/logger";

const bulkSchema = z.object({
  urls: z
    .array(z.string().url("Geçerli URL formatı gerekli"))
    .min(1, "En az 1 URL gerekli")
    .max(20, "Tek seferde en fazla 20 URL ekleyebilirsiniz"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rateLimited = await applyRateLimit(req, user?.id || null, RATE_LIMITS.bulkImport);
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0].message);
    }

    const { urls } = parsed.data;

    // Plan-based bulk import check (etkin plan: süresi dolmuş abonelik FREE sayılır)
    const features = getEffectiveFeatures(user);
    if (!features.hasBulkImport) {
      return new Response(
        JSON.stringify({
          error: "Toplu ürün ekleme özelliği Başlangıç ve üzeri planlarda kullanılabilir.",
          upgradeRequired: true,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check product limit
    const currentCount = await prisma.trackedProduct.count({
      where: { userId: user.id, status: { not: "PAUSED" } },
    });

    const maxProducts = user.maxProducts;
    const remaining = maxProducts - currentCount;

    if (remaining <= 0) {
      return forbidden(`Ürün limitinize ulaştınız (${maxProducts}). Planınızı yükseltin.`);
    }

    // Only process up to remaining limit
    const urlsToProcess = urls.slice(0, remaining);
    const skippedCount = urls.length - urlsToProcess.length;

    // Check for duplicate URLs already tracked by this user
    const existingProducts = await prisma.trackedProduct.findMany({
      where: {
        userId: user.id,
        productUrl: { in: urlsToProcess },
      },
      select: { productUrl: true },
    });
    const existingUrls = new Set(existingProducts.map((p) => p.productUrl));

    const scrapeInterval = features.scrapeIntervalMinutes;

    // Pazaryeri sayısı limiti — tekli ekleme ucuyla aynı kural. Bu kontrol
    // olmadan 2 pazaryerlik STARTER planı tek toplu istekle 9 pazaryerine
    // yayılabiliyordu.
    const usedMarketplaces = new Set(
      (
        await prisma.trackedProduct.groupBy({
          by: ["marketplace"],
          where: { userId: user.id },
        })
      ).map((m) => m.marketplace as string),
    );

    // Process each URL
    const results: Array<{
      url: string;
      status: "success" | "error" | "duplicate" | "skipped";
      message: string;
      product?: { id: string; marketplace: string };
    }> = [];

    for (const url of urlsToProcess) {
      // Check duplicate
      if (existingUrls.has(url)) {
        results.push({
          url,
          status: "duplicate",
          message: "Bu URL zaten takip ediliyor",
        });
        continue;
      }

      // Detect marketplace
      const marketplace = detectMarketplaceFromUrl(url);
      if (!isScraperSupportedMarketplace(marketplace)) {
        results.push({
          url,
          status: "error",
          message: "Desteklenmeyen pazar yeri",
        });
        continue;
      }

      if (
        features.marketplaceLimit < 99 &&
        !usedMarketplaces.has(marketplace) &&
        usedMarketplaces.size >= features.marketplaceLimit
      ) {
        results.push({
          url,
          status: "error",
          message: `Pazaryeri limitinize ulaştınız (${features.marketplaceLimit}). Planınızı yükseltin.`,
        });
        continue;
      }

      try {
        const product = await prisma.trackedProduct.create({
          data: {
            userId: user.id,
            productUrl: url,
            productName: "Yükleniyor...",
            marketplace: marketplace as Marketplace,
            status: "ACTIVE",
            scrapeInterval,
          },
        });

        existingUrls.add(url); // prevent same URL added twice in same batch
        usedMarketplaces.add(marketplace); // batch içi pazaryeri limiti tutarlılığı

        // Tekli ekleme ucuyla ayni sekilde ilk taramayi hemen kuyrukla —
        // aksi halde urunler zamanlayicinin dongusunu bekleyip "Yükleniyor..."
        // olarak kalir. Rakip kesfi bilerek kuyruklanmaz: urun adi henuz
        // "Yükleniyor..." oldugu icin coplu bir arama sorgusu uretirdi; adin
        // dolmasindan sonra periyodik kesif dongusu rakipleri kendisi bulur.
        try {
          await addScrapeJob(product.id, marketplace, url);
        } catch (queueError) {
          logger.error({ err: queueError, productId: product.id }, "Bulk scrape queue error");
        }

        results.push({
          url,
          status: "success",
          message: `${marketplace} ürünü eklendi`,
          product: { id: product.id, marketplace: product.marketplace },
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message?.includes("Unique")
            ? "Bu URL zaten takip ediliyor"
            : "Ekleme başarısız";
        results.push({
          url,
          status: "error",
          message,
        });
      }
    }

    // Add skipped results
    for (let i = urlsToProcess.length; i < urls.length; i++) {
      results.push({
        url: urls[i],
        status: "skipped",
        message: `Ürün limitiniz doldu (${maxProducts})`,
      });
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const errorCount = results.filter((r) => r.status === "error").length;
    const duplicateCount = results.filter((r) => r.status === "duplicate").length;

    // Ilk urunlerini toplu ekleyen kullanici da varsayilan hesap-geneli uyari
    // kurallarini almali (tekli ekleme ucundaki adimin karsiligi; idempotent).
    if (successCount > 0) {
      try {
        await ensureDefaultGlobalAlertRules({
          userId: user.id,
          plan: user.plan,
          alertThresholdPct: user.alertThresholdPct,
        });
      } catch (err) {
        logger.error({ err, userId: user.id }, "Bulk default alert rules error (non-fatal)");
      }
    }

    return apiSuccess({
      success: true,
      summary: {
        total: urls.length,
        added: successCount,
        errors: errorCount,
        duplicates: duplicateCount,
        skipped: skippedCount,
      },
      results,
    });
  } catch (error) {
    return serverError(error, "POST /api/products/bulk error");
  }
}
