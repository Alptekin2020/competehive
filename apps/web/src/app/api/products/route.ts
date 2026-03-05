import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { scrapeProduct } from "@/lib/scraper";
import { analyzeProduct } from "@/lib/ai-analyzer";
import { searchAllMarketplaces, findBestMatch } from "@/lib/marketplace-search";

const prisma = new PrismaClient();

function detectMarketplace(url: string): string | undefined {
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
  return undefined;
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
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giris yapmaniz gerekiyor" }, { status: 401 });
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
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giris yapmaniz gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    const body = await req.json();
    const { productUrl } = body;

    if (!productUrl) {
      return NextResponse.json({ error: "Urun URL'si gerekli" }, { status: 400 });
    }

    const marketplace = detectMarketplace(productUrl);
    if (!marketplace) {
      return NextResponse.json(
        { error: "Bu site desteklenmiyor. Desteklenen: Trendyol, Hepsiburada, Amazon TR, N11, Ciceksepeti, PTT AVM, Akakce, Cimri, Epey" },
        { status: 400 }
      );
    }

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

    // 3. Urunu veritabanina kaydet
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
        ${scraped.image},
        ${scraped.seller},
        ${scraped.price},
        ${scraped.currency},
        ${productStatus}::"ProductStatus",
        NOW(),
        ${metadataJson}::jsonb
      ) RETURNING *
    `;

    // 4. Fiyat gecmisine kaydet
    if (scraped.price) {
      await prisma.$queryRaw`
        INSERT INTO price_history (tracked_product_id, price, currency, in_stock, seller_name)
        VALUES (${product[0].id}::uuid, ${scraped.price}, ${scraped.currency}, ${scraped.inStock}, ${scraped.seller})
      `;
    }

    // 5. Diger marketplace'lerde ara
    let competitorResults: any[] = [];
    try {
      const allResults = await searchAllMarketplaces(analysis.searchKeywords, marketplace);

      for (const [mp, results] of Object.entries(allResults)) {
        const bestMatch = findBestMatch(results, analysis.shortTitle);
        if (bestMatch && bestMatch.price) {
          const compName = bestMatch.productName.substring(0, 200);
          const competitor = await prisma.$queryRaw<any[]>`
            INSERT INTO competitors (
              tracked_product_id, competitor_url, competitor_name,
              marketplace, current_price, last_scraped_at
            ) VALUES (
              ${product[0].id}::uuid,
              ${bestMatch.url},
              ${compName},
              ${mp}::"Marketplace",
              ${bestMatch.price},
              NOW()
            ) RETURNING *
          `;

          await prisma.$queryRaw`
            INSERT INTO competitor_prices (competitor_id, price, currency, in_stock)
            VALUES (${competitor[0].id}::uuid, ${bestMatch.price}, ${'TRY'}, ${bestMatch.inStock})
          `;

          competitorResults.push({
            marketplace: mp,
            name: bestMatch.productName,
            price: bestMatch.price,
            url: bestMatch.url,
            image: bestMatch.image,
          });
        }
      }
    } catch (err: any) {
      console.error("Cross-marketplace search error:", err);
    }

    return NextResponse.json({
      success: true,
      product: product[0],
      analysis,
      competitors: competitorResults,
    });
  } catch (error: any) {
    console.error("POST /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatasi: " + error.message }, { status: 500 });
  }
}

// DELETE - Urun sil
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giris yapmaniz gerekiyor" }, { status: 401 });
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
