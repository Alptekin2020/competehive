export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { scrapeProduct } from "@/lib/scraper";
import { analyzeProduct } from "@/lib/ai-analyzer";

const prisma = new PrismaClient();

function detectMarketplace(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("trendyol.com")) return "TRENDYOL";
  if (lower.includes("hepsiburada.com")) return "HEPSIBURADA";
  if (lower.includes("amazon.com.tr")) return "AMAZON_TR";
  if (lower.includes("n11.com")) return "N11";
  if (lower.includes("ciceksepeti.com")) return "CICEKSEPETI";
  if (lower.includes("pttavm.com")) return "PTTAVM";
  if (lower.includes("akakce.com")) return "AKAKCE";
  if (lower.includes("cimri.com")) return "CIMRI";
  if (lower.includes("epey.com")) return "EPEY";
  if (lower.includes("boyner.com")) return "BOYNER";
  if (lower.includes("gratis.com")) return "GRATIS";
  if (lower.includes("watsons.com")) return "WATSONS";
  if (lower.includes("kitapyurdu.com")) return "KITAPYURDU";
  if (lower.includes("decathlon.com")) return "DECATHLON";
  if (lower.includes("teknosa.com")) return "TEKNOSA";
  if (lower.includes("mediamarkt.com")) return "MEDIAMARKT";
  if (lower.includes("sephora.com")) return "SEPHORA";
  if (lower.includes("koctas.com")) return "KOCTAS";
  if (lower.includes("vatanbilgisayar.com")) return "VATAN";
  if (lower.includes("itopya.com")) return "ITOPYA";
  return "CUSTOM";
}

async function getOrCreateUser(clerkUserId: string) {
  let user = await prisma.$queryRaw<any[]>`
    SELECT * FROM users WHERE stripe_customer_id = ${clerkUserId} LIMIT 1
  `;
  if (user && user.length > 0) return user[0];

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || `${clerkUserId}@clerk.user`;
  const name = clerkUser?.firstName ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim() : "User";

  const newUser = await prisma.$queryRaw<any[]>`
    INSERT INTO users (email, password_hash, name, stripe_customer_id)
    VALUES (${email}, ${'clerk_managed'}, ${name}, ${clerkUserId})
    ON CONFLICT (email) DO UPDATE SET stripe_customer_id = ${clerkUserId}
    RETURNING *
  `;
  return newUser[0];
}

// GET - Kullanicinin urunlerini ve rakip fiyatlarini listele
export async function GET() {
  try {
    let userId: string | null = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch (e) {
      console.error("Auth error:", e);
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    const products = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products
      WHERE user_id = ${user.id}::uuid
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
    let userId: string | null = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch (e) {
      console.error("Auth error:", e);
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    const body = await req.json();
    const { productUrl } = body;

    if (!productUrl) {
      return NextResponse.json({ error: "Urun URL'si gerekli" }, { status: 400 });
    }

    const marketplace = detectMarketplace(productUrl);

    const productCount = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM tracked_products WHERE user_id = ${user.id}::uuid
    `;
    if (parseInt(productCount[0].count) >= user.max_products) {
      return NextResponse.json(
        { error: `Urun limitinize ulastiniz (${user.max_products}). Planinizi yukseltin.` },
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
        ${user.id}::uuid,
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
    let userId: string | null = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch (e) {
      console.error("Auth error:", e);
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
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
      DELETE FROM tracked_products WHERE id = ${productId}::uuid AND user_id = ${user.id}::uuid
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatasi: " + error.message }, { status: 500 });
  }
}
