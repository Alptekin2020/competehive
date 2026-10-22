export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { scrapeProduct } from "@/lib/scraper";
import {
  detectMarketplaceFromUrl,
  isTrackableMarketplace,
  storeDisplayName,
  storeKey,
  SUPPORTED_MARKETPLACE_LABEL,
} from "@/lib/marketplaces";
import { logger } from "@/lib/logger";
import { apiSuccess, unauthorized, badRequest, serverError } from "@/lib/api-response";
import { addProductSchema } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getEffectiveFeatures } from "@/lib/plan-gates";
import { getUsedStoreKeys, storeLimitError } from "@/lib/limits";
import { scrapeStorePage, type StoreSupportLevel } from "@/lib/store-scraper";
import { isGenericStoreMarketplace, normalizeProductImage } from "@competehive/shared";

interface PreviewProduct {
  name: string;
  price: number | null;
  currency: string;
  image: string | null;
  inStock: boolean;
}

interface PreviewResponse {
  marketplace: string;
  storeName: string;
  isOwnStore: boolean;
  support: StoreSupportLevel;
  canAdd: boolean;
  /** Turkish, user-facing reasons (why partial/unsupported, or why adding is blocked). */
  issues: string[];
  product: PreviewProduct | null;
}

// POST - Takibe almadan once urun sayfasini okuyup kullaniciya gosterir.
// Hicbir sey kaydetmez; amac kullanicinin "bu fiyat dogru mu?" onayini almak
// ve desteklenmeyen siteleri ekleme oncesinde nedeniyle birlikte bildirmek.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rl = await rateLimit(`rate:products-preview:${user.id}`, 20, 60, { failClosed: true });
    if (!rl.success) return rateLimitResponse(rl.reset);

    const parsed = addProductSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);
    const { productUrl } = parsed.data;

    const marketplace = detectMarketplaceFromUrl(productUrl);
    const isOwnStore = isGenericStoreMarketplace(marketplace);
    const base = {
      marketplace,
      storeName: storeDisplayName(marketplace, productUrl),
      isOwnStore,
    };

    if (!isTrackableMarketplace(marketplace)) {
      return apiSuccess<PreviewResponse>({
        ...base,
        support: "unsupported",
        canAdd: false,
        issues: [
          `Bu pazar yeri henüz desteklenmiyor. Desteklenen pazar yerleri: ${SUPPORTED_MARKETPLACE_LABEL} ve kendi e-ticaret siteniz.`,
        ],
        product: null,
      });
    }

    // Ekleme engelleri (kopya, plan mağaza limiti) sayfa okunmadan önce
    // bildirilir: kullanıcı önizlemeyi onaylayıp sonra reddedilmesin.
    const blockers: string[] = [];
    const existing = await prisma.trackedProduct.findFirst({
      where: { userId: user.id, productUrl },
      select: { id: true },
    });
    if (existing) blockers.push("Bu ürün zaten takip ediliyor.");
    const features = getEffectiveFeatures(user);
    if (features.marketplaceLimit < 99) {
      const limitError = storeLimitError(
        await getUsedStoreKeys(user.id),
        storeKey(marketplace, productUrl),
        features.marketplaceLimit,
      );
      if (limitError) blockers.push(limitError);
    }

    let support: StoreSupportLevel;
    let issues: string[];
    let product: PreviewProduct | null;

    if (isOwnStore) {
      const page = await scrapeStorePage(productUrl);
      support = page.support;
      issues = page.issues;
      product = page.support === "unsupported" ? null : page.product;
    } else {
      // Bilinen pazaryerleri: fiyat Vercel'den okunamasa bile worker
      // (Serper/Puppeteer) arka planda kurtarabildiği için ekleme engellenmez.
      try {
        const scraped = await scrapeProduct(productUrl, marketplace);
        product = scraped;
        support = scraped.price !== null ? "full" : "partial";
        issues =
          scraped.price !== null
            ? []
            : ["Fiyat şu an okunamadı; takibe aldıktan sonra arka planda yeniden denenecek."];
      } catch (err) {
        logger.warn({ err, marketplace }, "Preview scrape failed for known marketplace");
        product = null;
        support = "partial";
        issues = ["Ürün bilgisi şu an okunamadı; takibe aldıktan sonra arka planda denenecek."];
      }
    }

    return apiSuccess<PreviewResponse>({
      ...base,
      support,
      canAdd: support !== "unsupported" && blockers.length === 0,
      issues: [...blockers, ...issues],
      product: product && {
        name: product.name,
        price: product.price,
        currency: product.currency,
        image: normalizeProductImage(product.image),
        inStock: product.inStock,
      },
    });
  } catch (error) {
    return serverError(error, "POST /api/products/preview error");
  }
}
