import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { analyzeProduct } from "@/lib/ai-analyzer";
import { searchAllMarketplaces, findBestMatch } from "@/lib/marketplace-search";

export const maxDuration = 60;

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { productId } = await req.json();

    const product = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products WHERE id = ${productId}::uuid LIMIT 1
    `;
    if (!product?.length) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });

    const p = product[0];

    // AI analiz
    let keywords = [];
    try {
      if (p.metadata?.searchKeywords) {
        keywords = p.metadata.searchKeywords;
      } else {
        const analysis = await analyzeProduct(p.product_name, p.marketplace, p.current_price ? Number(p.current_price) : null);
        keywords = analysis.searchKeywords;
      }
    } catch {
      keywords = [p.product_name.split(" ").slice(0, 4).join(" ")];
    }

    // Marketplace ara (timeout'lu)
    const allResults = await searchAllMarketplaces(keywords, p.marketplace);
    const competitors = [];

    for (const [mp, results] of Object.entries(allResults)) {
      const best = findBestMatch(results, p.product_name);
      if (best && best.price) {
        try {
          const comp = await prisma.$queryRaw<any[]>`
            INSERT INTO competitors (tracked_product_id, competitor_url, competitor_name, marketplace, current_price, last_scraped_at)
            VALUES (${productId}::uuid, ${best.url}, ${best.productName.substring(0, 200)}, ${mp}::"Marketplace", ${best.price}, NOW())
            RETURNING *
          `;
          await prisma.$executeRawUnsafe(
            `INSERT INTO competitor_prices (competitor_id, price, currency, in_stock) VALUES ('${comp[0].id}', ${best.price}, 'TRY', true)`
          );
          competitors.push({ marketplace: mp, name: best.productName, price: best.price, url: best.url });
        } catch (e) { console.error("Competitor save error:", e); }
      }
    }

    return NextResponse.json({ success: true, competitors });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
