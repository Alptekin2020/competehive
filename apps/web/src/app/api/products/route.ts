export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { scrapeProduct } from "@/lib/scraper";
import { analyzeProduct } from "@/lib/ai-analyzer";
import { detectMarketplaceFromUrl } from "@/lib/marketplaces";

// GET - Kullanicinin urunlerini ve rakip fiyatlarini listele
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const products = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products
      WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
      ORDER BY created_at DESC
    `;

    const productsWithCompetitors = await Promise.all(
      products.map(async (product: any) => {
        const competitors = await prisma.$queryRaw<any[]>`
          SELECT c.*,
            (SELECT cp.price FROM competitor_prices cp WHERE cp.competitor_id = c.id ORDER BY cp.scraped_at DESC LIMIT 1) as latest_price
          FROM competitors c
          WHERE c.tracked_product_id = ${product.id}::uuid
          ORDER BY c.current_price ASC NULLS LAST
        `;
        return { ...product, competitors };
      })
    );

    return NextResponse.json({ products: productsWithCompetitors });
  } catch (error: any) {
    console.error("GET /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatasi: " + error.message }, { status: 500 });
  }
}

// POST - Yeni urun ekle + AI analiz + capraz marketplace arama
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { productUrl } = body;

    if (!productUrl) {
      return NextResponse.json({ error: "Urun URL'si gerekli" }, { status: 400 });
    }

    const marketplace = detectMarketplaceFromUrl(productUrl);

    const productCount = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM tracked_products WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
    `;
    if (parseInt(productCount[0].count) >= user.maxProducts) {
      return NextResponse.json(
        { error: `Urun limitinize ulastiniz (${user.maxProducts}). Planinizi yukseltin.` },
        { status: 403 }
      );
    }

    // 1. Urun sayfasini scrape et
    let scraped;
    try {
      scraped = await scrapeProduct(productUrl, marketplace);
    } catch (err: any) {
      console.error("Scrape error:", err);
      scraped = { name: "Urun adi alinamadi", price: null, currency: "TRY", image: null, seller: null, inStock: true };
    }

    // 2. AI ile urunu analiz et (marka, model, arama kelimeleri)
    let analysis;
    try {
      analysis = await analyzeProduct(scraped.name, marketplace, scraped.price);
    } catch (err: any) {
      console.error("AI analysis error:", err);
      analysis = {
        brand: "Bilinmiyor",
        model: scraped.name.substring(0, 50),
        category: "Genel",
        searchKeywords: [scraped.name.split(" ").slice(0, 4).join(" ")],
        shortTitle: scraped.name.substring(0, 80),
      };
    }

    // 3. Görsel URL temizleme — bazen JSON object geliyor
    let cleanImage: string | null = null;
    if (scraped.image) {
      if (typeof scraped.image === "string") {
        cleanImage = scraped.image;
      } else if (typeof scraped.image === "object") {
        const imgObj = scraped.image as any;
        if (imgObj.contentUrl) {
          cleanImage = Array.isArray(imgObj.contentUrl) ? imgObj.contentUrl[0] : imgObj.contentUrl;
        } else if (imgObj.url) {
          cleanImage = imgObj.url;
        } else if (Array.isArray(imgObj) && imgObj.length > 0) {
          cleanImage = typeof imgObj[0] === "string" ? imgObj[0] : null;
        }
      }
    }
    const imageUrl = cleanImage;

    // 4. Urunu veritabanina kaydet
    const productName = analysis.shortTitle || scraped.name;
    const metadataJson = JSON.stringify({
      brand: analysis.brand,
      model: analysis.model,
      category: analysis.category,
      searchKeywords: analysis.searchKeywords,
    });
    const productStatus = scraped.inStock ? "ACTIVE" : "OUT_OF_STOCK";

    const product = await prisma.$queryRaw<any[]>`
      INSERT INTO tracked_products (
        user_id, product_name, marketplace, product_url,
        product_image, seller_name, current_price, currency,
        status, last_scraped_at, metadata
      ) VALUES (
        (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text),
        ${productName},
        ${marketplace}::"Marketplace",
        ${productUrl},
        ${imageUrl},
        ${scraped.seller},
        ${scraped.price},
        ${scraped.currency},
        ${productStatus}::"ProductStatus",
        NOW(),
        ${metadataJson}::jsonb
      ) RETURNING *
    `;

    // 5. Fiyat gecmisine kaydet
    if (scraped.price) {
      await prisma.$queryRaw`
        INSERT INTO price_history (tracked_product_id, price, currency, in_stock, seller_name)
        VALUES (${product[0].id}::uuid, ${scraped.price}, ${scraped.currency}, ${scraped.inStock}, ${scraped.seller})
      `;
    }

    // 6. Trigger scrape fallback — parse product name from URL if scraper returned a bad name
    try {
      const baseUrl = req.nextUrl.origin;
      fetch(`${baseUrl}/api/scrape/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify({ productId: product[0].id }),
      }).catch((err) => console.error("Scrape trigger fire-and-forget error:", err));
    } catch (err) {
      console.error("Scrape trigger setup error:", err);
    }

    return NextResponse.json({
      success: true,
      product: product[0],
      analysis,
    });
  } catch (error: any) {
    console.error("POST /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatasi: " + error.message }, { status: 500 });
  }
}

// DELETE - Urun sil
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("id");

    if (!productId) {
      return NextResponse.json({ error: "Urun ID gerekli" }, { status: 400 });
    }

    // Cascade should handle competitors, but delete explicitly to be safe
    await prisma.$queryRaw`
      DELETE FROM competitors WHERE tracked_product_id = ${productId}::uuid
    `;
    await prisma.$queryRaw`
      DELETE FROM tracked_products WHERE id = ${productId}::uuid AND user_id = (SELECT id FROM users WHERE clerk_id = ${user.clerkId}::text)
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatasi: " + error.message }, { status: 500 });
  }
}
