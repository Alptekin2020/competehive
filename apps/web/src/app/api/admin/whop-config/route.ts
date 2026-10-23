import { getCurrentUser, isAdminUser } from "@/lib/current-user";
import { apiSuccess, forbidden, serverError, unauthorized } from "@/lib/api-response";
import { PLANS } from "@/lib/plans";
import { getWhopClient } from "@/lib/whop";
import {
  SELLABLE_TIERS,
  classifyWebhookSecret,
  evaluateWebhookReceipts,
  evaluateWhopEnv,
  evaluateWhopPlan,
  normalizeId,
  planFetchFailedCheck,
  summarizeChecks,
  whopWebhookUrl,
  type ConfigCheck,
  type PlanExpectation,
  type SellableTier,
  type WhopEnvSnapshot,
} from "@/lib/whop-config-check";
import { readWebhookReceipts } from "@/lib/whop-webhook-log";

export const dynamic = "force-dynamic";

function httpStatusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function buildEnvSnapshot(): WhopEnvSnapshot {
  const planFor = (tier: SellableTier) => PLANS.find((p) => p.id === tier);
  const byTier = (pick: (tier: SellableTier) => string | null | undefined) =>
    Object.fromEntries(SELLABLE_TIERS.map((t) => [t, normalizeId(pick(t))])) as Record<
      SellableTier,
      string | null
    >;

  // NEXT_PUBLIC_* değerleri statik erişimle okunur: Next.js bunları derleme
  // anında gömer, böylece burada görülen değer tarayıcının gördüğüyle aynıdır.
  const publicYearly: Record<SellableTier, string | undefined> = {
    STARTER: process.env.NEXT_PUBLIC_WHOP_STARTER_YEARLY_PLAN_ID,
    PRO: process.env.NEXT_PUBLIC_WHOP_PRO_YEARLY_PLAN_ID,
    ENTERPRISE: process.env.NEXT_PUBLIC_WHOP_ENTERPRISE_YEARLY_PLAN_ID,
  };
  const products: Record<SellableTier, string | undefined> = {
    STARTER: process.env.WHOP_STARTER_PRODUCT_ID,
    PRO: process.env.WHOP_PRO_PRODUCT_ID,
    ENTERPRISE: process.env.WHOP_ENTERPRISE_PRODUCT_ID,
  };

  return {
    hasApiKey: Boolean(process.env.WHOP_API_KEY),
    webhookSecret: classifyWebhookSecret(process.env.WHOP_WEBHOOK_SECRET),
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || null,
    products: byTier((t) => products[t]),
    monthlyPlans: byTier((t) => planFor(t)?.whopPlanId),
    yearlyPlans: byTier((t) => planFor(t)?.whopYearlyPlanId),
    publicYearlyPlans: byTier((t) => publicYearly[t]),
  };
}

function planExpectations(env: WhopEnvSnapshot): PlanExpectation[] {
  const expectations: PlanExpectation[] = [];
  for (const tier of SELLABLE_TIERS) {
    const plan = PLANS.find((p) => p.id === tier);
    if (!plan) continue;
    const monthly = env.monthlyPlans[tier];
    if (monthly) {
      expectations.push({
        tier,
        billing: "monthly",
        planId: monthly,
        expectedProductId: env.products[tier],
        displayedPrice: plan.price,
      });
    }
    const yearly = env.yearlyPlans[tier];
    if (yearly) {
      expectations.push({
        tier,
        billing: "yearly",
        planId: yearly,
        expectedProductId: env.products[tier],
        // Fiyat sayfası yıllıkta aylık eşdeğeri gösterir; Whop yılda bir tahsil eder.
        displayedPrice: plan.yearlyPrice * 12,
      });
    }
  }
  return expectations;
}

async function liveChecks(env: WhopEnvSnapshot): Promise<ConfigCheck[]> {
  if (!env.hasApiKey) {
    return [
      {
        id: "live-skipped",
        label: "Canlı kontrol",
        status: "error",
        detail: "WHOP_API_KEY tanımlı olmadığı için Whop'a sorulamadı.",
      },
    ];
  }
  const expectations = planExpectations(env);
  if (expectations.length === 0) {
    return [
      {
        id: "live-skipped",
        label: "Canlı kontrol",
        status: "error",
        detail: "Kontrol edilecek plan ID'si yok — önce plan ID'lerini tanımlayın.",
      },
    ];
  }

  const whop = getWhopClient();
  const results = await Promise.allSettled(expectations.map((e) => whop.plans.retrieve(e.planId)));

  const checks: ConfigCheck[] = [];
  const failedStatuses: Array<number | null> = [];
  results.forEach((result, i) => {
    const exp = expectations[i];
    if (result.status === "fulfilled") {
      checks.push(evaluateWhopPlan(exp, result.value));
    } else {
      const status = httpStatusOf(result.reason);
      failedStatuses.push(status);
      console.error(
        "[admin/whop-config] plan retrieve failed plan=" +
          exp.planId +
          ": " +
          String(result.reason),
      );
      checks.push(planFetchFailedCheck(exp, status));
    }
  });

  const allRejectedAuth =
    failedStatuses.length === results.length && failedStatuses.every((s) => s === 401 || s === 403);
  checks.unshift(
    allRejectedAuth
      ? {
          id: "api-key-valid",
          label: "WHOP_API_KEY geçerliliği",
          status: "error",
          detail:
            "Whop tüm istekleri reddetti — anahtar geçersiz, iptal edilmiş ya da plan okuma izni yok. Whop panelinden yeni bir şirket API anahtarı oluşturun.",
        }
      : failedStatuses.length < results.length
        ? {
            id: "api-key-valid",
            label: "WHOP_API_KEY geçerliliği",
            status: "ok",
            detail: "Whop API'ye erişildi.",
          }
        : {
            id: "api-key-valid",
            label: "WHOP_API_KEY geçerliliği",
            status: "warn",
            detail: "Hiçbir plan okunamadı — aşağıdaki hata ayrıntılarına bakın.",
          },
  );
  return checks;
}

async function webhookChecks(env: WhopEnvSnapshot): Promise<ConfigCheck[]> {
  try {
    return evaluateWebhookReceipts(await readWebhookReceipts(), env.appUrl);
  } catch (error) {
    console.error("[admin/whop-config] webhook receipts unavailable:", error);
    return [
      {
        id: "webhook-receipts",
        label: "Webhook kaydı",
        status: "warn",
        detail: "Webhook teslimat kaydı okunamadı (Redis erişilemiyor).",
      },
    ];
  }
}

// GET - Whop ödeme yapılandırması teşhisi (yalnızca yöneticiler). Gizli
// değerleri asla döndürmez; yalnızca tanımlı/doğru olup olmadıklarını ve
// Whop'taki planların ürün/para birimi/fiyat eşleşmesini raporlar.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (!isAdminUser({ clerkId: user.clerkId, email: user.email })) {
      return forbidden("Bu işlem için yetkiniz yok");
    }

    const env = buildEnvSnapshot();
    const [live, webhook] = await Promise.all([liveChecks(env), webhookChecks(env)]);
    const sections = [
      { id: "env", title: "Ortam değişkenleri (Vercel)", checks: evaluateWhopEnv(env) },
      { id: "live", title: "Whop planları (canlı kontrol)", checks: live },
      { id: "webhook", title: "Webhook teslimatı", checks: webhook },
    ];

    return apiSuccess({
      generatedAt: new Date().toISOString(),
      webhookUrl: whopWebhookUrl(env.appUrl),
      summary: summarizeChecks(sections.flatMap((s) => s.checks)),
      sections,
    });
  } catch (error) {
    return serverError(error, "GET /api/admin/whop-config error");
  }
}
