import prisma from "@/lib/prisma";

import { resolveEffectivePlan, type PlanInfo } from "./plan-resolve";

export type { PlanInfo } from "./plan-resolve";
export { resolveEffectivePlan, FREE_PLAN_LIMITS } from "./plan-resolve";

export async function getUserPlanInfo(userId: string): Promise<PlanInfo> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planStatus: true, planExpiresAt: true },
  });

  return resolveEffectivePlan(user);
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
  const usage = await getUserUsage(userId);

  if (usage.productCount >= planInfo.maxProducts) {
    return {
      allowed: false,
      reason: `${planInfo.planDisplayName} planınızda ${planInfo.maxProducts} ürün limitinize ulaştınız. Daha fazla ürün eklemek için planınızı yükseltebilirsiniz.`,
      current: usage.productCount,
      limit: planInfo.maxProducts,
      plan: planInfo.plan,
    };
  }

  return {
    allowed: true,
    current: usage.productCount,
    limit: planInfo.maxProducts,
    plan: planInfo.plan,
  };
}
