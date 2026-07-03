import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { isPaidTier } from "@/lib/plan-resolve";
import { getWhopClient } from "@/lib/whop";

export const dynamic = "force-dynamic";

// Ücretli kullanıcının aboneliğini Whop üzerinden yönetebilmesi (iptal, ödeme
// yöntemi, faturalar) için manage_url döndürür. Uygulama içinde bir iptal
// yolu olmazsa kullanıcılar temiz iptal yerine ters ibraz (chargeback) açar.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  if (!isPaidTier(user.plan) || !user.whopMembershipId) {
    return NextResponse.json({ subscription: null });
  }

  try {
    const whop = getWhopClient();
    const membership = await whop.memberships.retrieve(user.whopMembershipId);
    return NextResponse.json({
      subscription: {
        plan: user.plan,
        status: membership?.status ?? null,
        manageUrl: membership?.manage_url ?? null,
        cancelAtPeriodEnd: membership?.cancel_at_period_end ?? false,
        renewalPeriodEnd: membership?.renewal_period_end ?? null,
      },
    });
  } catch (error) {
    console.error("[subscription] failed to retrieve membership:", error);
    // Whop erişilemiyorsa bile plan bilgisini döndür — UI linki gizler.
    return NextResponse.json({
      subscription: { plan: user.plan, status: null, manageUrl: null },
    });
  }
}
