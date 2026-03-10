import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    // Fetch the product from DB
    const products = await prisma.$queryRaw<any[]>`
      SELECT id, product_url, product_name, marketplace, status
      FROM tracked_products
      WHERE id = ${productId}::uuid AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
    `;

    if (!products || products.length === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const product = products[0];

    // Parse a readable name from the URL slug as fallback
    const parsedName = parseProductNameFromUrl(product.product_url);

    // Only update the name if the current one is the scraper fallback
    const isFallbackName =
      !product.product_name ||
      product.product_name === "Urun adi alinamadi" ||
      product.product_name.endsWith(" ürünü") ||
      /ürünü\s*[-–]\s*Online/i.test(product.product_name);
    const needsNameUpdate = parsedName && isFallbackName;

    if (needsNameUpdate) {
      await prisma.$queryRaw`
        UPDATE tracked_products
        SET product_name = ${parsedName},
            status = 'ACTIVE'::"ProductStatus"
        WHERE id = ${productId}::uuid AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
      `;
    } else if (product.status !== "ACTIVE") {
      // At minimum, set status to ACTIVE
      await prisma.$queryRaw`
        UPDATE tracked_products
        SET status = 'ACTIVE'::"ProductStatus"
        WHERE id = ${productId}::uuid AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
      `;
    }

    return NextResponse.json({
      success: true,
      updatedName: needsNameUpdate ? parsedName : product.product_name,
    });
  } catch (error: any) {
    console.error("POST /api/scrape/trigger error:", error);
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
