import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { PrismaClient } from "@prisma/client";
import { searchAllMarketplaces, findBestMatch } from "@/lib/marketplace-search";

export const maxDuration = 60;

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const { productId } = await req.json();
    console.log("[CompeteHive Compare] Called with productId:", productId);
    if (!productId) {
      return NextResponse.json({ error: "productId gerekli" }, { status: 400 });
    }

    // Ürünü bul
    const products = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products WHERE id = ${productId}::uuid LIMIT 1
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

    // Tüm marketplace'lerde ara
    const allResults = await searchAllMarketplaces(keywords, product.marketplace);
    console.log("[CompeteHive Compare] Results:", JSON.stringify(Object.keys(allResults)));
    const competitors: any[] = [];

    console.log("Search results:", Object.keys(allResults).map(k => `${k}: ${allResults[k].length} results`));

    for (const [mp, results] of Object.entries(allResults)) {
      const best = findBestMatch(results, product.product_name);
      if (best && best.price) {
        const compName = best.storeName
          ? `${best.storeName} — ${best.productName}`.substring(0, 200)
          : best.productName.substring(0, 200);
        try {
          // Mevcut competitor varsa güncelle, yoksa ekle
          const existing = await prisma.$queryRaw<any[]>`
            SELECT id FROM competitors
            WHERE tracked_product_id = ${productId}::uuid AND marketplace = ${mp}::"Marketplace"
            LIMIT 1
          `;

          if (existing?.length) {
            await prisma.$executeRaw`
              UPDATE competitors SET
                competitor_url = ${best.url.substring(0, 500)},
                competitor_name = ${compName},
                current_price = ${best.price},
                last_scraped_at = NOW()
              WHERE id = ${existing[0].id}::uuid
            `;
            competitors.push({ marketplace: mp, name: compName, price: best.price, url: best.url });
          } else {
            const comp = await prisma.$queryRaw<any[]>`
              INSERT INTO competitors (tracked_product_id, competitor_url, competitor_name, marketplace, current_price, last_scraped_at)
              VALUES (
                ${productId}::uuid,
                ${best.url.substring(0, 500)},
                ${compName},
                ${mp}::"Marketplace",
                ${best.price},
                NOW()
              ) RETURNING *
            `;

            if (comp?.[0]) {
              await prisma.$executeRaw`
                INSERT INTO competitor_prices (competitor_id, price, currency, in_stock)
                VALUES (${comp[0].id}::uuid, ${best.price}, 'TRY', true)
              `;
              competitors.push({ marketplace: mp, name: compName, price: best.price, url: best.url });
            }
          }
        } catch (e) {
          console.error(`Competitor save error for ${mp}:`, e);
        }
      }
    }

    console.log("Found competitors:", competitors.length);

    return NextResponse.json({ success: true, competitors });
  } catch (error: any) {
    console.error("Compare error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
