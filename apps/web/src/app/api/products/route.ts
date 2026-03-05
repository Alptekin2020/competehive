import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { scrapeProduct } from "@/lib/scraper";

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

// Clerk userId ile DB user'ı eşleştir veya oluştur
async function getOrCreateUser(clerkUserId: string) {
  // Önce mevcut kullanıcıyı ara (stripe_customer_id alanını clerk_id olarak kullanıyoruz geçici olarak)
  let user = await prisma.$queryRaw<any[]>`
    SELECT * FROM users WHERE stripe_customer_id = ${clerkUserId} LIMIT 1
  `;

  if (user && user.length > 0) {
    return user[0];
  }

  // Clerk'ten kullanıcı bilgilerini al
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || `${clerkUserId}@clerk.user`;
  const name = clerkUser?.firstName ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim() : "User";

  // Yeni kullanıcı oluştur
  const newUser = await prisma.$queryRaw<any[]>`
    INSERT INTO users (email, password_hash, name, stripe_customer_id)
    VALUES (${email}, ${'clerk_managed'}, ${name}, ${clerkUserId})
    ON CONFLICT (email) DO UPDATE SET stripe_customer_id = ${clerkUserId}
    RETURNING *
  `;

  return newUser[0];
}

// GET - Kullanıcının ürünlerini listele
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    const products = await prisma.$queryRaw<any[]>`
      SELECT * FROM tracked_products
      WHERE user_id = ${user.id}::uuid
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ products });
  } catch (error: any) {
    console.error("GET /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatası: " + error.message }, { status: 500 });
  }
}

// POST - Yeni ürün ekle
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    const body = await req.json();
    const { productUrl } = body;

    if (!productUrl) {
      return NextResponse.json({ error: "Ürün URL'si gerekli" }, { status: 400 });
    }
    try {
      new URL(productUrl);
    } catch (_) {
      return NextResponse.json({ error: "Geçerli bir URL girin" }, { status: 400 });
    }

    // Marketplace algıla
    const marketplace = detectMarketplace(productUrl);
    if (!marketplace) {
      return NextResponse.json(
        { error: "Bu site henüz desteklenmiyor. Desteklenen siteler: Trendyol, Hepsiburada, Amazon TR, N11, Çiçeksepeti, PTT AVM, Akakçe, Cimri, Epey" },
        { status: 400 }
      );
    }

    // Ürün limitini kontrol et
    const productCount = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM tracked_products WHERE user_id = ${user.id}::uuid
    `;
    const count = parseInt(productCount[0].count);

    if (count >= user.max_products) {
      return NextResponse.json(
        { error: `Ürün limitinize ulaştınız (${user.max_products}). Planınızı yükseltin.` },
        { status: 403 }
      );
    }

    // URL'den geçici ürün adı çıkar (fallback)
    let fallbackName = "Ürün yükleniyor...";
    try {
      const urlObj = new URL(productUrl);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      if (pathParts.length > 0) {
        fallbackName = pathParts[pathParts.length - 1]
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .substring(0, 100);
      }
    } catch (error) {
      console.warn("Could not parse product name from URL, using default.", { productUrl, error });
    }

    // Fiyat çek
    let scraped;
    try {
      scraped = await scrapeProduct(productUrl, marketplace);
    } catch (scrapeError: any) {
      console.error("Scrape error:", scrapeError);
      scraped = { name: fallbackName, price: null, currency: "TRY", image: null, seller: null, inStock: true };
    }

    const productName = scraped.name !== "Urun adi alinamadi" ? scraped.name : fallbackName;

    // Veritabanına kaydet
    const product = await prisma.$queryRaw<any[]>`
      INSERT INTO tracked_products (
        user_id, product_name, marketplace, product_url,
        product_image, seller_name, current_price, currency,
        status, last_scraped_at
      ) VALUES (
        ${user.id}::uuid, ${productName}, ${marketplace}::"Marketplace", ${productUrl},
        ${scraped.image}, ${scraped.seller}, ${scraped.price}, ${scraped.currency},
        ${scraped.inStock ? "ACTIVE" : "OUT_OF_STOCK"}::"ProductStatus", NOW()
      ) RETURNING *
    `;

    // Fiyat geçmişine kaydet
    if (scraped.price) {
      await prisma.$queryRaw`
        INSERT INTO price_history (tracked_product_id, price, currency, in_stock, seller_name)
        VALUES (${product[0].id}::uuid, ${scraped.price}, ${scraped.currency}, ${scraped.inStock}, ${scraped.seller})
      `;
    }

    return NextResponse.json({
      success: true,
      product: product[0],
    });
  } catch (error: any) {
    console.error("POST /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatası: " + error.message }, { status: 500 });
  }
}

// DELETE - Ürün sil
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("id");

    if (!productId) {
      return NextResponse.json({ error: "Ürün ID gerekli" }, { status: 400 });
    }

    await prisma.$executeRaw`
      DELETE FROM tracked_products WHERE id = ${productId}::uuid AND user_id = ${user.id}::uuid
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/products error:", error);
    return NextResponse.json({ error: "Sunucu hatası: " + error.message }, { status: 500 });
  }
}
