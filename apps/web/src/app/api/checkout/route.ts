import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getWhopClient } from "@/lib/whop";
import { PLANS, isUpgrade, isSellablePlanId } from "@/lib/plans";
import { resolveEffectivePlan } from "@/lib/plan-resolve";
import { applyRateLimit } from "@/lib/with-rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkoutSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }

    const rateLimited = await applyRateLimit(req, user?.id || null, RATE_LIMITS.checkout);
    if (rateLimited) return rateLimited;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
    }
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Geçersiz plan" },
        { status: 400 },
      );
    }
    const { planId, billing } = parsed.data;

    const targetPlan = PLANS.find((p) => p.id === planId);
    if (!targetPlan) {
      return NextResponse.json({ error: "Geçersiz plan" }, { status: 400 });
    }

    // Get user's current plan
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { plan: true, planStatus: true, planExpiresAt: true, email: true },
    });

    if (!userRecord) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
    }

    // Yükseltme kontrolü ham kolona değil EFEKTİF plana bakmalı: süresi dolmuş
    // (limitleri fiilen FREE uygulanan) bir PRO kullanıcısı PRO'yu yeniden
    // satın alabilmeli — ham kolon PRO göründüğü için 'düşük veya eşit' diye
    // reddedilirse ödemeye istekli müşteri geri çevrilmiş olur.
    const effectivePlan = resolveEffectivePlan(userRecord).plan;
    if (!isUpgrade(effectivePlan, planId)) {
      return NextResponse.json(
        { error: "Bu plan mevcut planınızdan düşük veya eşit" },
        { status: 400 },
      );
    }

    // Select the correct Whop plan ID
    const whopPlanId = billing === "yearly" ? targetPlan.whopYearlyPlanId : targetPlan.whopPlanId;
    if (!isSellablePlanId(whopPlanId)) {
      // Yıllık ID eksik ama aylık satılabiliyorsa nedeni doğru söyle — plan
      // satışta, yalnızca yıllık seçenek kapalı.
      if (billing === "yearly" && isSellablePlanId(targetPlan.whopPlanId)) {
        return NextResponse.json(
          { error: "Bu plan için yıllık ödeme henüz aktif değil. Aylık ödemeyi seçebilirsiniz." },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "Bu plan henüz satışa hazır değil" }, { status: 400 });
    }

    // Create Whop checkout session
    const whop = getWhopClient();

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://www.competehive.com").replace(
      /\/$/,
      "",
    );

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
    // İç hata metnini (İngilizce SDK/config mesajları, API anahtarı ipuçları)
    // son kullanıcıya sızdırma — logla, kullanıcıya genel Türkçe mesaj dön.
    console.error("Checkout creation error:", error);
    return NextResponse.json(
      { error: "Ödeme oturumu oluşturulamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
