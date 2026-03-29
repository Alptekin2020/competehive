import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getPlanFeatures } from "@/lib/plan-gates";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true, maxProducts: true },
    });

    const plan = userRecord?.plan || "FREE";
    const features = getPlanFeatures(plan);

    const [productCount, alertRuleCount, tagCount, marketplaceCount] = await Promise.all([
      prisma.trackedProduct.count({
        where: { userId: user.id, status: { not: "PAUSED" } },
      }),
      prisma.alertRule.count({
        where: { userId: user.id, isActive: true },
      }),
      prisma.tag.count({
        where: { userId: user.id },
      }),
      prisma.trackedProduct
        .groupBy({
          by: ["marketplace"],
          where: { userId: user.id },
        })
        .then((r) => r.length),
    ]);

    return NextResponse.json({
      plan,
      features,
      usage: {
        products: productCount,
        alertRules: alertRuleCount,
        tags: tagCount,
        marketplaces: marketplaceCount,
      },
      limits: {
        productsRemaining: Math.max(0, features.maxProducts - productCount),
        alertRulesRemaining: Math.max(0, features.maxAlertRules - alertRuleCount),
        tagsRemaining: Math.max(0, features.maxTags - tagCount),
        marketplacesRemaining: Math.max(0, features.marketplaceLimit - marketplaceCount),
      },
    });
  } catch (error) {
    console.error("Features API error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
