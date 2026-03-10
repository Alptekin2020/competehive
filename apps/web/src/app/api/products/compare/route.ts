import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { searchAllResults, normalizeMarketplaceResult } from "@/lib/marketplace-search";

export const maxDuration = 60;

const DOMAIN_LABELS: Record<string, { name: string; color: string }> = {
  "trendyol.com": { name: "Trendyol", color: "#F27A1A" },
  "hepsiburada.com": { name: "Hepsiburada", color: "#FF6000" },
  "amazon.com.tr": { name: "Amazon TR", color: "#FF9900" },
  "n11.com": { name: "N11", color: "#7B2D8E" },
  "mediamarkt.com.tr": { name: "MediaMarkt", color: "#FF0000" },
  "teknosa.com": { name: "Teknosa", color: "#0066CC" },
  "vatanbilgisayar.com": { name: "Vatan", color: "#CC0000" },
};

function getRetailerInfo(url: string) {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const label = DOMAIN_LABELS[domain];
    return {
      retailerDomain: domain,
      retailerName: label?.name ?? domain,
      retailerColor: label?.color ?? "#6B7280",
    };
  } catch {
    return {
      retailerDomain: "unknown",
      retailerName: "Unknown",
      retailerColor: "#6B7280",
    };
  }
}


export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId } = await req.json();
    console.log("[CompeteHive Compare] Called with productId:", productId);
    if (!productId) {
      return NextResponse.json({ error: "productId gerekli" }, { status: 400 });
    }

    // Ürünü bul
    const products = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products WHERE id = ${productId}::uuid AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text) LIMIT 1
    `;
    if (!products?.length) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
    }

    const product = products[0];

    // Anahtar kelimeler — metadata'dan veya ürün adından
    let keywords: string[] = [];
    try {
      const meta = typeof product.metadata === "string" ? JSON.parse(product.metadata) : product.metadata;
      if (meta?.searchKeywords?.length) {
        keywords = meta.searchKeywords;
      }
    } catch {}

    if (keywords.length === 0) {
      // Ürün adından anahtar kelimeler çıkar
      keywords = [product.product_name.split(" ").slice(0, 5).join(" ")];
    }

    console.log("Compare searching for:", keywords, "excluding:", product.marketplace);

    // Tüm web'de ara (marketplace filtresi yok)
    const allResults = await searchAllResults(keywords, product.marketplace);
    console.log("[CompeteHive Compare] Total results:", allResults.length);
    const competitors: any[] = [];
    const insertErrors: Array<Record<string, unknown>> = [];
    let skippedCount = 0;
    let errorCount = 0;

    for (const result of allResults) {
      if (!result.price || !result.url) {
        skippedCount += 1;
        continue;
      }

      const normalizedResult = normalizeMarketplaceResult(result, "fallback-custom");
      if (!normalizedResult) {
        skippedCount += 1;
        continue;
      }

      const mp = normalizedResult.marketplace;
      const normalizedUrl = normalizedResult.url.substring(0, 500);
      const compName = normalizedResult.storeName
        ? `${normalizedResult.storeName} — ${normalizedResult.productName}`.substring(0, 200)
        : normalizedResult.productName.substring(0, 200);

      try {
        const comp = await prisma.$queryRaw<any[]>`
          INSERT INTO competitors (tracked_product_id, competitor_url, competitor_name, marketplace, current_price, last_scraped_at)
          VALUES (
            ${productId}::uuid,
            ${normalizedUrl},
            ${compName},
            ${mp}::"Marketplace",
            ${normalizedResult.price},
            NOW()
          )
          ON CONFLICT (tracked_product_id, competitor_url)
          DO UPDATE SET
            competitor_name = EXCLUDED.competitor_name,
            marketplace = EXCLUDED.marketplace,
            current_price = EXCLUDED.current_price,
            last_scraped_at = EXCLUDED.last_scraped_at
          RETURNING *
        `;

        if (comp?.[0]) {
          await prisma.$executeRaw`
            INSERT INTO competitor_prices (competitor_id, price, currency, in_stock)
            VALUES (${comp[0].id}::uuid, ${normalizedResult.price}, 'TRY', true)
          `;
          const retailer = getRetailerInfo(normalizedResult.url);
          competitors.push({
            marketplace: mp,
            name: compName,
            price: normalizedResult.price,
            url: normalizedResult.url,
            link: normalizedResult.url,
            retailerDomain: retailer.retailerDomain,
            retailerName: retailer.retailerName,
            retailerColor: retailer.retailerColor,
          });
        }
      } catch (e: any) {
        errorCount += 1;
        insertErrors.push({
          marketplace: mp,
          url: normalizedUrl,
          message: e?.message ?? "Unknown insert error",
          code: e?.code ?? null,
        });
      }
    }

    if (insertErrors.length) {
      console.error("[CompeteHive Compare] Competitor insert errors", {
        productId,
        totalErrors: insertErrors.length,
        errors: insertErrors,
      });
    }

    // Sort by price ascending
    competitors.sort((a, b) => a.price - b.price);

    console.log("Found competitors:", competitors.length);

    return NextResponse.json({ success: true, competitors, skippedCount, errorCount });
  } catch (error: any) {
    console.error("Compare error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
