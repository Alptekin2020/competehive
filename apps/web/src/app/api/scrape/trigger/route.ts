import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, badRequest, notFound, serverError } from "@/lib/api-response";
import { scrapeTrigerSchema } from "@/lib/validation";

/**
 * Parse a readable product name from a marketplace URL slug.
 * e.g. "https://www.trendyol.com/brand/urun-adi-guzel-p-12345" => "Urun Adi Guzel"
 */
function parseProductNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    // Remove trailing slash and split by "/"
    const segments = pathname.replace(/\/$/, "").split("/").filter(Boolean);

    if (segments.length === 0) return null;

    // Take the last meaningful segment (usually the product slug)
    let slug = segments[segments.length - 1];

    // Remove common suffixes like "-p-12345", "-pm-12345", query-like tails
    slug = slug
      .replace(/-p-\d+.*$/i, "")
      .replace(/-pm-\d+.*$/i, "")
      .replace(/-pi-\d+.*$/i, "")
      .replace(/-pr-\d+.*$/i, "")
      .replace(/\?.*$/, "");

    // If the slug looks like only a numeric ID, try the previous segment
    if (/^\d+$/.test(slug) && segments.length > 1) {
      slug = segments[segments.length - 2];
      slug = slug
        .replace(/-p-\d+.*$/i, "")
        .replace(/-pm-\d+.*$/i, "")
        .replace(/\?.*$/, "");
    }

    if (!slug || slug.length < 3) return null;

    // Convert dashes to spaces and title-case each word
    const name = slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    return name || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const body = await req.json();
    const parsed = scrapeTrigerSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const { productId } = parsed.data;

    // Fetch the product from DB
    const product = await prisma.trackedProduct.findFirst({
      where: { id: productId, userId: user.id },
      select: {
        id: true,
        productUrl: true,
        productName: true,
        marketplace: true,
        status: true,
      },
    });

    if (!product) {
      return notFound("Product not found");
    }

    // Parse a readable name from the URL slug as fallback
    const parsedName = parseProductNameFromUrl(product.productUrl);

    // Only update the name if the current one is the scraper fallback
    const isFallbackName =
      !product.productName ||
      product.productName === "Urun adi alinamadi" ||
      product.productName.endsWith(" ürünü") ||
      /ürünü\s*[-–]\s*Online/i.test(product.productName);
    const needsNameUpdate = parsedName && isFallbackName;

    if (needsNameUpdate) {
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: { productName: parsedName, status: "ACTIVE" },
      });
    } else if (product.status !== "ACTIVE") {
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: { status: "ACTIVE" },
      });
    }

    return apiSuccess({
      success: true,
      updatedName: needsNameUpdate ? parsedName : product.productName,
    });
  } catch (error) {
    return serverError(error, "POST /api/scrape/trigger");
  }
}
