// Whop ödeme yapılandırması teşhisi (yönetici "Ödeme Ayarları" sayfası).
//
// Saf fonksiyonlar: ortam değişkenlerinin anlık görüntüsünü ve Whop API'sinden
// çekilen plan kayıtlarını değerlendirip Türkçe kontrol satırları üretir. Gizli
// değerler (API anahtarı, webhook secret) bu modüle hiç girmez — yalnızca
// "tanımlı mı / biçimi doğru mu" bilgisi gelir. I/O route'ta yapılır.

export type CheckStatus = "ok" | "warn" | "error";

export interface ConfigCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  details?: string[];
}

export type SellableTier = "STARTER" | "PRO" | "ENTERPRISE";
export type BillingPeriod = "monthly" | "yearly";

export const SELLABLE_TIERS: readonly SellableTier[] = ["STARTER", "PRO", "ENTERPRISE"];

export const TIER_LABELS: Record<SellableTier, string> = {
  STARTER: "Başlangıç",
  PRO: "Profesyonel",
  ENTERPRISE: "Kurumsal",
};

export type WebhookSecretState = "missing" | "ok" | "unexpected-format";

export interface WhopEnvSnapshot {
  hasApiKey: boolean;
  webhookSecret: WebhookSecretState;
  appUrl: string | null;
  products: Record<SellableTier, string | null>;
  // Sunucunun checkout'ta gerçekten kullandığı plan ID'leri (plans.ts çözümlemesi).
  monthlyPlans: Record<SellableTier, string | null>;
  yearlyPlans: Record<SellableTier, string | null>;
  // Tarayıcıya derleme anında gömülen yıllık ID'ler — yıllık seçeneğinin
  // fiyat/checkout sayfasında görünmesi bunlara bağlıdır.
  publicYearlyPlans: Record<SellableTier, string | null>;
}

const ENV_NAMES = {
  product: (t: SellableTier) => `WHOP_${t}_PRODUCT_ID`,
  monthly: (t: SellableTier) => `WHOP_${t}_PLAN_ID`,
  yearly: (t: SellableTier) => `WHOP_${t}_YEARLY_PLAN_ID`,
  publicYearly: (t: SellableTier) => `NEXT_PUBLIC_WHOP_${t}_YEARLY_PLAN_ID`,
};

export function classifyWebhookSecret(secret: string | undefined | null): WebhookSecretState {
  if (!secret) return "missing";
  return /^(ws_|whsec_)/.test(secret) ? "ok" : "unexpected-format";
}

/** Placeholder sentinel'leri ve boş değerler "tanımsız" sayılır (plans.ts ile aynı kural). */
export function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("PLACEHOLDER")) return null;
  return trimmed;
}

function duplicateGroups(entries: Array<[string, string | null]>): string[][] {
  const byValue = new Map<string, string[]>();
  for (const [name, value] of entries) {
    if (!value) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), name]);
  }
  return [...byValue.values()].filter((names) => names.length > 1);
}

export function whopWebhookUrl(appUrl: string | null): string {
  const base = (appUrl || "https://www.competehive.com").replace(/\/$/, "");
  return `${base}/api/webhooks/whop`;
}

export function evaluateWhopEnv(env: WhopEnvSnapshot): ConfigCheck[] {
  const checks: ConfigCheck[] = [];

  checks.push(
    env.hasApiKey
      ? { id: "api-key", label: "WHOP_API_KEY", status: "ok", detail: "Tanımlı." }
      : {
          id: "api-key",
          label: "WHOP_API_KEY",
          status: "error",
          detail: "Tanımlı değil — ödeme oturumu açılamaz, kimse satın alamaz.",
        },
  );

  checks.push({
    id: "webhook-secret",
    label: "WHOP_WEBHOOK_SECRET",
    status: env.webhookSecret === "ok" ? "ok" : env.webhookSecret === "missing" ? "error" : "warn",
    detail:
      env.webhookSecret === "ok"
        ? "Tanımlı."
        : env.webhookSecret === "missing"
          ? "Tanımlı değil — webhook'lar reddedilir; ödeme yapan kullanıcının planı hiç yükselmez."
          : "Tanımlı ama beklenen biçimde değil (ws_ ile başlamalı). İmza doğrulaması başarısız olabilir — Whop panelindeki webhook secret'ı birebir kopyalayın.",
  });

  for (const tier of SELLABLE_TIERS) {
    const name = ENV_NAMES.product(tier);
    const value = env.products[tier];
    checks.push(
      !value
        ? {
            id: `product-${tier}`,
            label: name,
            status: "warn",
            detail:
              "Tanımlı değil. Uygulama içi ödemeler checkout bilgisiyle yine doğru plana eşlenir, ama Whop'tan doğrudan yapılan satın almalar eşlenemez.",
          }
        : {
            id: `product-${tier}`,
            label: name,
            status: value.startsWith("prod_") ? "ok" : "warn",
            detail: value.startsWith("prod_")
              ? value
              : `${value} — Whop ürün ID'leri "prod_" ile başlar; değeri kontrol edin.`,
          },
    );
  }

  const productDuplicates = duplicateGroups(
    SELLABLE_TIERS.map((t) => [ENV_NAMES.product(t), env.products[t]]),
  );
  checks.push(
    productDuplicates.length === 0
      ? {
          id: "products-distinct",
          label: "Ürünler birbirinden ayrı",
          status: "ok",
          detail: "Her plan ayrı bir Whop ürününe bağlı.",
        }
      : {
          id: "products-distinct",
          label: "Ürünler birbirinden ayrı",
          status: "error",
          detail:
            "Aynı ürün ID'si birden fazla plana verilmiş — webhook bu satın almaların hepsini tek bir plana eşler (müşteri yanlış plan alır).",
          details: productDuplicates.map((names) => names.join(" = ")),
        },
  );

  for (const tier of SELLABLE_TIERS) {
    const name = ENV_NAMES.monthly(tier);
    const value = env.monthlyPlans[tier];
    checks.push(
      !value
        ? {
            id: `plan-monthly-${tier}`,
            label: `${TIER_LABELS[tier]} — aylık plan`,
            status: "error",
            detail: `${name} tanımlı değil — bu plan satışa kapalı ("Bu plan henüz satışa hazır değil").`,
          }
        : {
            id: `plan-monthly-${tier}`,
            label: `${TIER_LABELS[tier]} — aylık plan`,
            status: value.startsWith("plan_") ? "ok" : "warn",
            detail: value.startsWith("plan_")
              ? value
              : `${value} — Whop plan ID'leri "plan_" ile başlar; değeri kontrol edin.`,
          },
    );
  }

  for (const tier of SELLABLE_TIERS) {
    const serverValue = env.yearlyPlans[tier];
    const publicValue = env.publicYearlyPlans[tier];
    const label = `${TIER_LABELS[tier]} — yıllık plan`;
    if (!serverValue) {
      checks.push({
        id: `plan-yearly-${tier}`,
        label,
        status: "warn",
        detail: `${ENV_NAMES.yearly(tier)} tanımlı değil — yıllık seçenek kapalı (opsiyonel).`,
      });
    } else if (!publicValue) {
      checks.push({
        id: `plan-yearly-${tier}`,
        label,
        status: "warn",
        detail: `Sunucuda tanımlı (${serverValue}) ama tarayıcıya gömülü değil — yıllık seçenek kullanıcıya hiç gösterilmez. ${ENV_NAMES.publicYearly(tier)} ekleyip yeniden deploy edin.`,
      });
    } else if (publicValue !== serverValue) {
      checks.push({
        id: `plan-yearly-${tier}`,
        label,
        status: "warn",
        detail: `Sunucu (${serverValue}) ile tarayıcıdaki değer (${publicValue}) farklı — iki değişkeni eşitleyip yeniden deploy edin.`,
      });
    } else {
      checks.push({ id: `plan-yearly-${tier}`, label, status: "ok", detail: serverValue });
    }
  }

  const planDuplicates = duplicateGroups([
    ...SELLABLE_TIERS.map((t): [string, string | null] => [
      ENV_NAMES.monthly(t),
      env.monthlyPlans[t],
    ]),
    ...SELLABLE_TIERS.map((t): [string, string | null] => [
      ENV_NAMES.yearly(t),
      env.yearlyPlans[t],
    ]),
  ]);
  if (planDuplicates.length > 0) {
    checks.push({
      id: "plans-distinct",
      label: "Plan ID'leri birbirinden ayrı",
      status: "error",
      detail:
        "Aynı plan ID'si birden fazla yere verilmiş — müşteri seçtiğinden farklı plana yönlenir.",
      details: planDuplicates.map((names) => names.join(" = ")),
    });
  }

  checks.push(evaluateAppUrl(env.appUrl));
  return checks;
}

function evaluateAppUrl(appUrl: string | null): ConfigCheck {
  const label = "NEXT_PUBLIC_APP_URL";
  if (!appUrl) {
    return {
      id: "app-url",
      label,
      status: "warn",
      detail:
        "Tanımlı değil — ödeme dönüşü varsayılan https://www.competehive.com'a gider, ama Telegram bağlantıları ve OG meta da bu değeri kullanır. Ayarlayın.",
    };
  }
  let host: string;
  let protocol: string;
  try {
    const parsed = new URL(appUrl);
    host = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    return { id: "app-url", label, status: "error", detail: `${appUrl} geçerli bir adres değil.` };
  }
  if (protocol !== "https:") {
    return { id: "app-url", label, status: "warn", detail: `${appUrl} — https olmalı.` };
  }
  if (host === "competehive.com") {
    return {
      id: "app-url",
      label,
      status: "warn",
      detail: `${appUrl} — alan adı www'siz; tüm istekler www'ye 307 ile yönleniyor. https://www.competehive.com olarak ayarlayın.`,
    };
  }
  return { id: "app-url", label, status: "ok", detail: appUrl };
}

// ---- Whop plan kaydı (canlı) ----

/** Whop SDK Shared.Plan'ın teşhis için gereken alt kümesi. */
export interface WhopPlanRecord {
  id: string;
  billing_period: number | null;
  currency: string;
  initial_price: number;
  renewal_price: number;
  plan_type: string;
  product: { id: string; title?: string | null } | null;
  release_method?: string | null;
  trial_period_days: number | null;
  visibility?: string | null;
}

export interface PlanExpectation {
  tier: SellableTier;
  billing: BillingPeriod;
  planId: string;
  expectedProductId: string | null;
  /** Sitede gösterilen ve dönem başına tahsil edilmesi beklenen TL tutarı. */
  displayedPrice: number;
}

function formatTry(value: number): string {
  return value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function planLabel(exp: PlanExpectation): string {
  return `${TIER_LABELS[exp.tier]} — ${exp.billing === "yearly" ? "yıllık" : "aylık"}`;
}

const STATUS_RANK: Record<CheckStatus, number> = { ok: 0, warn: 1, error: 2 };

export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    "ok",
  );
}

export function evaluateWhopPlan(exp: PlanExpectation, plan: WhopPlanRecord): ConfigCheck {
  const issues: Array<{ status: CheckStatus; text: string }> = [];
  const currency = (plan.currency || "").toUpperCase();

  const actualProductId = plan.product?.id ?? null;
  const productName = plan.product?.title
    ? `"${plan.product.title}" (${actualProductId})`
    : actualProductId;
  if (exp.expectedProductId && actualProductId !== exp.expectedProductId) {
    issues.push({
      status: "error",
      text: `Bu plan ${productName ?? "bilinmeyen"} ürününe bağlı, ${ENV_NAMES.product(exp.tier)} ise ${exp.expectedProductId}. Webhook bu satın almayı yanlış plana eşler.`,
    });
  } else if (!exp.expectedProductId && actualProductId) {
    issues.push({
      status: "warn",
      text: `${ENV_NAMES.product(exp.tier)} tanımlı değil; bu plan ${productName} ürününde — değişkeni bu ID'ye ayarlayın.`,
    });
  }

  if (plan.plan_type !== "renewal") {
    issues.push({
      status: "error",
      text: "Tek seferlik plan — abonelik yenilenmez, ilk dönemden sonra kullanıcı Ücretsiz'e düşer.",
    });
  }

  if (currency !== "TRY") {
    issues.push({
      status: "error",
      text: `Para birimi ${currency || "bilinmiyor"} — sitede ₺ gösteriliyor, müşteri farklı tutar görür.`,
    });
  }

  const period = plan.billing_period;
  const periodOk =
    period !== null &&
    (exp.billing === "monthly" ? period >= 28 && period <= 31 : period >= 360 && period <= 366);
  if (plan.plan_type === "renewal" && !periodOk) {
    issues.push({
      status: "warn",
      text: `Faturalama aralığı ${period ?? "?"} gün — ${exp.billing === "monthly" ? "aylık plan için 30" : "yıllık plan için 365"} bekleniyordu.`,
    });
  }

  if (Math.abs(plan.renewal_price - exp.displayedPrice) > 0.5) {
    issues.push({
      status: "warn",
      text: `Whop'taki dönem fiyatı ${formatTry(plan.renewal_price)} ${currency}, sitede gösterilen ${formatTry(exp.displayedPrice)} ₺.`,
    });
  }

  if (plan.initial_price > 0) {
    issues.push({
      status: "warn",
      text: `İlk ödemede ek ${formatTry(plan.initial_price)} ${currency} tahsil edilir — sitede gösterilmiyor.`,
    });
  }

  if (plan.trial_period_days && plan.trial_period_days > 0) {
    issues.push({
      status: "warn",
      text: `${plan.trial_period_days} gün ücretsiz deneme tanımlı — fiyat sayfasında belirtilmiyor.`,
    });
  }

  if (plan.visibility === "archived") {
    issues.push({ status: "error", text: "Plan arşivlenmiş — satın alınamaz." });
  }
  if (plan.release_method === "waitlist") {
    issues.push({
      status: "error",
      text: "Plan bekleme listesi modunda — doğrudan satın alınamaz.",
    });
  }

  const status = worstStatus(issues.map((i) => i.status));
  const summary = `${exp.planId} · ${formatTry(plan.renewal_price)} ${currency}/${period ?? "?"} gün${
    actualProductId ? ` · ürün ${actualProductId}` : ""
  }`;
  return {
    id: `live-${exp.tier}-${exp.billing}`,
    label: planLabel(exp),
    status,
    detail: issues.length === 0 ? `Doğru — ${summary}` : summary,
    details: issues.length > 0 ? issues.map((i) => i.text) : undefined,
  };
}

/** Whop API çağrısı başarısız olduğunda plan satırı. */
export function planFetchFailedCheck(exp: PlanExpectation, httpStatus: number | null): ConfigCheck {
  const reason =
    httpStatus === 404
      ? "Whop'ta bu ID ile bir plan yok (silinmiş veya yanlış kopyalanmış)."
      : httpStatus === 401 || httpStatus === 403
        ? "Whop API isteği reddedildi — WHOP_API_KEY geçersiz ya da bu plana erişim izni yok."
        : `Whop API'ye ulaşılamadı${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`;
  return {
    id: `live-${exp.tier}-${exp.billing}`,
    label: planLabel(exp),
    status: "error",
    detail: exp.planId,
    details: [reason],
  };
}

// ---- Webhook teslimatı ----

export interface WebhookReceipt {
  at: string;
  type?: string;
}

export function evaluateWebhookReceipts(
  receipts: { lastOk: WebhookReceipt | null; lastFail: WebhookReceipt | null },
  appUrl: string | null,
): ConfigCheck[] {
  const url = whopWebhookUrl(appUrl);
  const checks: ConfigCheck[] = [];
  const { lastOk, lastFail } = receipts;

  checks.push(
    lastOk
      ? {
          id: "webhook-last-ok",
          label: "Son doğrulanmış webhook",
          status: "ok",
          detail: `${lastOk.at}${lastOk.type ? ` · ${lastOk.type}` : ""}`,
        }
      : {
          id: "webhook-last-ok",
          label: "Son doğrulanmış webhook",
          status: "warn",
          detail: `Henüz kayıt yok (kayıt bu özellikle başladı). Whop panelinde webhook adresinin ${url} olduğundan emin olun; www'siz adres 307 ile yönlendiği için webhook'lar teslim edilmez.`,
        },
  );

  const failIsNewer =
    lastFail !== null && (lastOk === null || Date.parse(lastFail.at) > Date.parse(lastOk.at));
  if (failIsNewer) {
    checks.push({
      id: "webhook-last-fail",
      label: "İmza doğrulaması",
      status: "error",
      detail: `Son webhook (${lastFail.at}) imza doğrulamasından geçemedi — WHOP_WEBHOOK_SECRET, Whop panelindeki webhook secret ile eşleşmiyor olabilir.`,
    });
  }

  return checks;
}

export function summarizeChecks(checks: ConfigCheck[]): Record<CheckStatus, number> {
  const summary: Record<CheckStatus, number> = { ok: 0, warn: 0, error: 0 };
  for (const c of checks) summary[c.status]++;
  return summary;
}
