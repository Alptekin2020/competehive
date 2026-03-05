import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

// ============================================
// GET /api/products - Kullanıcının ürünlerini listele
// ============================================

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
  }

  const products = await prisma.trackedProduct.findMany({
    where: { userId: userId },
    include: {
      priceHistory: {
        orderBy: { scrapedAt: "desc" },
        take: 30, // Son 30 veri noktası
      },
      alertRules: {
        where: { isActive: true },
      },
      _count: {
        select: { competitors: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ products });
}

// ============================================
// POST /api/products - Yeni ürün takibe al
// ============================================

const addProductSchema = z.object({
  productUrl: z.string().url("Geçerli bir URL girin"),
  productName: z.string().optional(),
  marketplace: z.enum(["TRENDYOL", "HEPSIBURADA", "AMAZON_TR", "N11"]).optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = addProductSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    // Kullanıcının ürün limitini kontrol et
    const currentCount = await prisma.trackedProduct.count({
      where: { userId: userId, status: { not: "PAUSED" } },
    });

    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxProducts: true, plan: true },
    });

    if (currentCount >= (userRecord?.maxProducts || 5)) {
      return NextResponse.json(
        { error: `Ürün limitinize ulaştınız (${userRecord?.maxProducts}). Daha fazla ürün takip etmek için planınızı yükseltin.` },
        { status: 403 }
      );
    }

    // Marketplace'i URL'den tespit et
    const { productUrl, productName } = parsed.data;
    let marketplace = parsed.data.marketplace;

    if (!marketplace) {
      marketplace = detectMarketplace(productUrl);
      if (!marketplace) {
        return NextResponse.json(
          { error: "Bu marketplace henüz desteklenmiyor. Trendyol, Hepsiburada, Amazon TR ve N11 desteklenmektedir." },
          { status: 400 }
        );
      }
    }

    // Ürünü oluştur
    const product = await prisma.trackedProduct.create({
      data: {
        userId: userId,
        productUrl,
        productName: productName || "Yükleniyor...",
        marketplace,
        status: "ACTIVE",
        scrapeInterval: getScrapeInterval(userRecord?.plan || "FREE"),
      },
    });

    // TODO: İlk scrape job'ı queue'ya ekle
    // await addScrapeJob(product.id, marketplace);

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error) {
    console.error("Add product error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}

// ============================================
// DELETE /api/products - Ürün takibini kaldır
// ============================================

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Giriş yapmanız gerekiyor" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");

  if (!productId) {
    return NextResponse.json({ error: "Ürün ID gerekli" }, { status: 400 });
  }

  // Kullanıcının kendi ürünü mü?
  const product = await prisma.trackedProduct.findFirst({
    where: { id: productId, userId: userId },
  });

  if (!product) {
    return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  }

  await prisma.trackedProduct.delete({ where: { id: productId } });

  return NextResponse.json({ success: true });
}

// ============================================
// Helpers
// ============================================

function detectMarketplace(url: string): "TRENDYOL" | "HEPSIBURADA" | "AMAZON_TR" | "N11" | undefined {
  const lower = url.toLowerCase();
  if (lower.includes("trendyol.com")) return "TRENDYOL";
  if (lower.includes("hepsiburada.com")) return "HEPSIBURADA";
  if (lower.includes("amazon.com.tr")) return "AMAZON_TR";
  if (lower.includes("n11.com")) return "N11";
  return undefined;
}

function getScrapeInterval(plan: string): number {
  switch (plan) {
    case "ENTERPRISE": return 5;
    case "PRO": return 15;
    case "STARTER": return 60;
    default: return 1440; // Free = günde 1
  }
}
