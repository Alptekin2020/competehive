import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { resolveEffectivePlan } from "@/lib/plan-resolve";
import { apiSuccess, unauthorized, notFound, serverError } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return unauthorized();
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        plan: true,
        planStatus: true,
        planExpiresAt: true,
        maxProducts: true,
        stripeCustomerId: true,
        whopMembershipId: true,
        createdAt: true,
      },
    });

    if (!userRecord) {
      return notFound("Kullanıcı bulunamadı");
    }

    const [productCount, competitorCount, alertRuleCount, notificationCount] = await Promise.all([
      prisma.trackedProduct.count({
        where: { userId: user.id, status: { not: "PAUSED" } },
      }),
      prisma.competitor.count({
        where: { trackedProduct: { userId: user.id } },
      }),
      prisma.alertRule.count({
        where: { userId: user.id, isActive: true },
      }),
      prisma.notification.count({
        where: { userId: user.id },
      }),
    ]);

    const marketplacesInUse = await prisma.trackedProduct.groupBy({
      by: ["marketplace"],
      where: { userId: user.id },
    });

    // Ham kolon değil EFEKTİF plan dönülür: limitleri fiilen FREE uygulanan
    // (süresi dolmuş/iptal edilmiş) bir kullanıcıya UI "PRO — Mevcut Plan"
    // gösterirse yeniden satın alma butonu hiç çıkmaz. Diğer tüm özellik
    // kapıları da resolveEffectivePlan kullanır — burada da aynı gerçek geçerli.
    const effective = resolveEffectivePlan(userRecord);

    return apiSuccess({
      plan: effective.plan,
      maxProducts: effective.maxProducts,
      hasStripe: !!userRecord.stripeCustomerId,
      hasWhopMembership: !!userRecord.whopMembershipId,
      memberSince: userRecord.createdAt,
      usage: {
        products: productCount,
        competitors: competitorCount,
        alertRules: alertRuleCount,
        notifications: notificationCount,
        marketplaces: marketplacesInUse.length,
      },
    });
  } catch (error) {
    return serverError(error, "Plan API");
  }
}
