import prisma from "@/lib/prisma";

import { PLAN_LIMITS, type PlanTier } from "./plans";

export interface PlanInfo {
  hasActivePlan: boolean;
  plan: PlanTier | null;
  planDisplayName: string | null;
  maxProducts: number;
  refreshIntervalHours: number;
  expiresAt: Date | null;
}

const PAID_TIERS: ReadonlySet<string> = new Set(["STARTER", "PRO", "ENTERPRISE"]);

function isPaidTier(plan: string | null | undefined): plan is PlanTier {
  return !!plan && PAID_TIERS.has(plan);
}

export async function getUserPlanInfo(userId: string): Promise<PlanInfo> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planStatus: true, planExpiresAt: true },
  });

  const empty: PlanInfo = {
    hasActivePlan: false,
    plan: null,
    planDisplayName: null,
    maxProducts: 0,
    refreshIntervalHours: 0,
    expiresAt: null,
  };

  if (!user || !isPaidTier(user.plan)) return empty;
  if (user.planStatus !== "ACTIVE") {
    return { ...empty, plan: user.plan, expiresAt: user.planExpiresAt };
  }
  if (user.planExpiresAt && user.planExpiresAt < new Date()) {
    return { ...empty, plan: user.plan, expiresAt: user.planExpiresAt };
  }

  const limits = PLAN_LIMITS[user.plan];
  if (!limits) return empty;

  return {
    hasActivePlan: true,
    plan: user.plan,
    planDisplayName: limits.displayName,
    maxProducts: limits.maxProducts,
    refreshIntervalHours: limits.refreshIntervalHours,
    expiresAt: user.planExpiresAt,
  };
}

export async function getUserUsage(userId: string): Promise<{ productCount: number }> {
  const productCount = await prisma.trackedProduct.count({ where: { userId } });
  return { productCount };
}

export interface AddProductCheck {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  plan?: string;
}

export async function canAddProduct(userId: string): Promise<AddProductCheck> {
  const planInfo = await getUserPlanInfo(userId);
  if (!planInfo.hasActivePlan) {
    return {
      allowed: false,
      reason: "Aktif bir aboneliğiniz yok. Ürün takibine başlamak için lütfen bir plan seçin.",
    };
  }
  const usage = await getUserUsage(userId);
  if (usage.productCount >= planInfo.maxProducts) {
    return {
      allowed: false,
      reason: `${planInfo.planDisplayName} planınızda ${planInfo.maxProducts} ürün limitinize ulaştınız. Daha fazla ürün eklemek için planınızı yükseltebilirsiniz.`,
      current: usage.productCount,
      limit: planInfo.maxProducts,
      plan: planInfo.plan ?? undefined,
    };
  }
  return {
    allowed: true,
    current: usage.productCount,
    limit: planInfo.maxProducts,
    plan: planInfo.plan ?? undefined,
  };
}
