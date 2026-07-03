import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getEffectiveFeatures } from "@/lib/plan-gates";
import { resolveEffectivePlan } from "@/lib/plan-resolve";

function isMissingTagsTableError(error: unknown): boolean {
  const prismaError = error as { code?: unknown; meta?: { table?: unknown } } | undefined;
  if (prismaError?.code === "P2021") {
    const table = String(prismaError.meta?.table ?? "").toLowerCase();
    if (table.includes("tags")) return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("public.tags") && message.includes("does not exist");
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true, planStatus: true, planExpiresAt: true, maxProducts: true },
    });

    // Etkin plan: süresi dolmuş/iptal edilmiş abonelik FREE olarak raporlanır,
    // böylece UI kapıları ile API kapıları aynı gerçeği görür.
    const plan = resolveEffectivePlan(userRecord ?? null).plan;
    const features = getEffectiveFeatures(userRecord ?? null);

    const [productCount, alertRuleCount, tagCount, marketplaceCount] = await Promise.all([
      prisma.trackedProduct.count({
        where: { userId: user.id, status: { not: "PAUSED" } },
      }),
      prisma.alertRule.count({
        where: { userId: user.id, isActive: true },
      }),
      prisma.tag
        .count({
          where: { userId: user.id },
        })
        .catch((error) => {
          if (isMissingTagsTableError(error)) {
            console.warn(
              "[GET /api/user/features] tags table is missing during rollout; defaulting tag usage to 0",
            );
            return 0;
          }

          throw error;
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
