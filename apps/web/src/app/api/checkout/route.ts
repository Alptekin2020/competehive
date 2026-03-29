import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getWhopClient } from "@/lib/whop";
import { PLANS, isUpgrade } from "@/lib/plans";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const body = await req.json();
    const { planId, billing = "monthly" } = body;

    // Find the target plan
    const targetPlan = PLANS.find((p) => p.id === planId);
    if (!targetPlan) {
      return NextResponse.json({ error: "Geçersiz plan" }, { status: 400 });
    }

    // Can't checkout for FREE plan
    if (planId === "FREE") {
      return NextResponse.json(
        { error: "Ücretsiz plana geçiş için ödeme gerekmez" },
        { status: 400 },
      );
    }

    // Get user's current plan
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true, email: true },
    });

    if (!userRecord) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    // Check if this is actually an upgrade
    if (!isUpgrade(userRecord.plan, planId)) {
      return NextResponse.json(
        { error: "Bu plan mevcut planınızdan düşük veya eşit" },
        { status: 400 },
      );
    }

    // Select the correct Whop plan ID
    const whopPlanId = billing === "yearly" ? targetPlan.whopYearlyPlanId : targetPlan.whopPlanId;
    if (!whopPlanId || whopPlanId.includes("PLACEHOLDER")) {
      return NextResponse.json(
        { error: "Bu plan henüz satışa hazır değil" },
        { status: 400 },
      );
    }

    // Create Whop checkout session
    const whop = getWhopClient();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://competehive-web.vercel.app";

    const checkoutConfig = await whop.checkoutConfigurations.create({
      plan_id: whopPlanId,
      redirect_url: `${appUrl}/dashboard/pricing?success=true&plan=${planId}`,
      metadata: {
        competehive_user_id: user.id,
        competehive_plan: planId,
        competehive_email: userRecord.email,
        billing_period: billing,
      },
    });

    // Return the checkout URL
    return NextResponse.json({
      success: true,
      checkoutUrl: checkoutConfig.purchase_url,
      sessionId: checkoutConfig.id,
    });
  } catch (error: unknown) {
    console.error("Checkout creation error:", error);
    const message = error instanceof Error ? error.message : "Ödeme oturumu oluşturulamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
