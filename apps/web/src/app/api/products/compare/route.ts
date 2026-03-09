import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { searchAllResults } from "@/lib/marketplace-search";

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

    // Delete old competitors for this product before inserting fresh results
    await prisma.$executeRaw`
      DELETE FROM competitor_prices WHERE competitor_id IN (
        SELECT id FROM competitors WHERE tracked_product_id = ${productId}::uuid
      )
    `;
    await prisma.$executeRaw`
      DELETE FROM competitors WHERE tracked_product_id = ${productId}::uuid
    `;

    for (const result of allResults) {
      if (!result.price) continue;
      const mp = result.marketplace;
      const compName = result.storeName
        ? `${result.storeName} — ${result.productName}`.substring(0, 200)
        : result.productName.substring(0, 200);
      try {
        const comp = await prisma.$queryRaw<any[]>`
          INSERT INTO competitors (tracked_product_id, competitor_url, competitor_name, marketplace, current_price, last_scraped_at)
          VALUES (
            ${productId}::uuid,
            ${result.url.substring(0, 500)},
            ${compName},
            ${mp}::"Marketplace",
            ${result.price},
            NOW()
          ) RETURNING *
        `;

        if (comp?.[0]) {
          await prisma.$executeRaw`
            INSERT INTO competitor_prices (competitor_id, price, currency, in_stock)
            VALUES (${comp[0].id}::uuid, ${result.price}, 'TRY', true)
          `;
          const retailer = getRetailerInfo(result.url);
          competitors.push({
            marketplace: mp,
            name: compName,
            price: result.price,
            url: result.url,
            link: result.url,
            retailerDomain: retailer.retailerDomain,
            retailerName: retailer.retailerName,
            retailerColor: retailer.retailerColor,
          });
        }
      } catch (e) {
        console.error(`Competitor save error for ${mp}:`, e);
      }
    }

    // Sort by price ascending
    competitors.sort((a, b) => a.price - b.price);

    console.log("Found competitors:", competitors.length);

    return NextResponse.json({ success: true, competitors });
  } catch (error: any) {
    console.error("Compare error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
