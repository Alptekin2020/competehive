import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { getUserPlanInfo, getUserUsage } from "@/lib/limits";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const planInfo = await getUserPlanInfo(user.id);
  const usage = await getUserUsage(user.id);

  return NextResponse.json({
    hasActivePlan: planInfo.hasActivePlan,
    plan: planInfo.plan,
    planDisplayName: planInfo.planDisplayName,
    maxProducts: planInfo.maxProducts,
    currentProductCount: usage.productCount,
    expiresAt: planInfo.expiresAt,
  });
}
