import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { addCompetitorSearchJob } from "@/lib/queue";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { resolveEffectivePlan } from "@/lib/plan-resolve";

// Plana göre günlük keşif tavanı. Her keşif turu ücretli dış API çağrısı
// (Serper + OpenAI) tetikler; yalnızca dakikalık limitle bir kullanıcı günde
// yüzlerce tur çalıştırıp sınırsız maliyet üretebilirdi.
const DAILY_DISCOVERY_QUOTA: Record<string, number> = {
  FREE: 5,
  STARTER: 20,
  PRO: 50,
  ENTERPRISE: 150,
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401 });

  // Each search enqueues a Serper-backed discovery job (paid per call), so
  // throttle per user to keep a stuck/abused button from running up cost.
  // Maliyet koruması olduğu için Redis kesintisinde fail-closed çalışır.
  const rl = await rateLimit(`rate:compsearch:${user.id}`, 5, 300, { failClosed: true });
  if (!rl.success) return rateLimitResponse(rl.reset);

  const effectiveTier = resolveEffectivePlan(user).plan;
  const dailyQuota = DAILY_DISCOVERY_QUOTA[effectiveTier] ?? DAILY_DISCOVERY_QUOTA.FREE;
  const daily = await rateLimit(`rate:compsearch-daily:${user.id}`, dailyQuota, 86400, {
    failClosed: true,
  });
  if (!daily.success) {
    return NextResponse.json(
      {
        error: `Günlük rakip arama limitinize ulaştınız (${dailyQuota}/gün). Yarın tekrar deneyin veya planınızı yükseltin.`,
        upgradeRequired: true,
      },
      { status: 429 },
    );
  }

  const { id } = await params;
  const product = await prisma.trackedProduct.findFirst({
    where: { id, userId: user.id },
  });

  if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });

  try {
    await addCompetitorSearchJob(
      product.id,
      product.productName || product.productUrl,
      product.marketplace,
    );
    return NextResponse.json({ success: true, message: "Rakip arama başlatıldı" });
  } catch (error) {
    console.error("Queue error:", error);
    return NextResponse.json({ error: "Kuyruk hatası" }, { status: 500 });
  }
}
