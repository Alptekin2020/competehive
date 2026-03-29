import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { detectMarketplaceFromUrl } from "@/lib/marketplaces";
import { apiSuccess, unauthorized, badRequest, forbidden, serverError } from "@/lib/api-response";
import { z } from "zod";
import { PLAN_LIMITS } from "@competehive/shared";
import { Marketplace } from "@prisma/client";

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

    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0].message);
    }

    const { urls } = parsed.data;

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

    const scrapeInterval = PLAN_LIMITS[user.plan]?.scrapeIntervalMinutes ?? 1440;

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
      if (marketplace === "CUSTOM") {
        results.push({
          url,
          status: "error",
          message: "Desteklenmeyen marketplace",
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
