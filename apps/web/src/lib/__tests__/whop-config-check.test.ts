import { describe, it, expect } from "vitest";
import {
  classifyWebhookSecret,
  evaluateWebhookReceipts,
  evaluateWhopEnv,
  evaluateWhopPlan,
  normalizeId,
  planFetchFailedCheck,
  summarizeChecks,
  type PlanExpectation,
  type WhopEnvSnapshot,
  type WhopPlanRecord,
} from "../whop-config-check";

function healthyEnv(overrides: Partial<WhopEnvSnapshot> = {}): WhopEnvSnapshot {
  return {
    hasApiKey: true,
    webhookSecret: "ok",
    appUrl: "https://www.competehive.com",
    products: { STARTER: "prod_s", PRO: "prod_p", ENTERPRISE: "prod_e" },
    monthlyPlans: { STARTER: "plan_sm", PRO: "plan_pm", ENTERPRISE: "plan_em" },
    yearlyPlans: { STARTER: "plan_sy", PRO: "plan_py", ENTERPRISE: "plan_ey" },
    publicYearlyPlans: { STARTER: "plan_sy", PRO: "plan_py", ENTERPRISE: "plan_ey" },
    ...overrides,
  };
}

function byId(checks: ReturnType<typeof evaluateWhopEnv>, id: string) {
  const check = checks.find((c) => c.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
}

describe("classifyWebhookSecret / normalizeId", () => {
  it("classifies the webhook secret without exposing it", () => {
    expect(classifyWebhookSecret(undefined)).toBe("missing");
    expect(classifyWebhookSecret("ws_abc")).toBe("ok");
    expect(classifyWebhookSecret("whsec_abc")).toBe("ok");
    expect(classifyWebhookSecret("abc")).toBe("unexpected-format");
  });

  it("treats placeholders and blanks as unset", () => {
    expect(normalizeId("plan_PRO_PLACEHOLDER")).toBeNull();
    expect(normalizeId("  ")).toBeNull();
    expect(normalizeId(" plan_x ")).toBe("plan_x");
  });
});

describe("evaluateWhopEnv", () => {
  it("reports a fully configured environment as healthy", () => {
    const checks = evaluateWhopEnv(healthyEnv());
    expect(summarizeChecks(checks)).toEqual({ ok: checks.length, warn: 0, error: 0 });
  });

  it("flags a product ID shared by several tiers as an error", () => {
    const checks = evaluateWhopEnv(
      healthyEnv({ products: { STARTER: "prod_same", PRO: "prod_same", ENTERPRISE: "prod_e" } }),
    );
    const distinct = byId(checks, "products-distinct");
    expect(distinct.status).toBe("error");
    expect(distinct.details).toEqual(["WHOP_STARTER_PRODUCT_ID = WHOP_PRO_PRODUCT_ID"]);
  });

  it("marks a missing monthly plan as not for sale and a missing API key as an error", () => {
    const checks = evaluateWhopEnv(
      healthyEnv({
        hasApiKey: false,
        monthlyPlans: { STARTER: "plan_sm", PRO: null, ENTERPRISE: "plan_em" },
      }),
    );
    expect(byId(checks, "api-key").status).toBe("error");
    expect(byId(checks, "plan-monthly-PRO").status).toBe("error");
  });

  it("warns when a yearly plan is server-only and never reaches the browser", () => {
    const checks = evaluateWhopEnv(
      healthyEnv({
        publicYearlyPlans: { STARTER: null, PRO: "plan_py", ENTERPRISE: "plan_other" },
      }),
    );
    expect(byId(checks, "plan-yearly-STARTER").status).toBe("warn");
    expect(byId(checks, "plan-yearly-PRO").status).toBe("ok");
    expect(byId(checks, "plan-yearly-ENTERPRISE").status).toBe("warn");
  });

  it("flags duplicated plan IDs and an apex app URL", () => {
    const checks = evaluateWhopEnv(
      healthyEnv({
        monthlyPlans: { STARTER: "plan_dup", PRO: "plan_dup", ENTERPRISE: "plan_em" },
        appUrl: "https://competehive.com",
      }),
    );
    expect(byId(checks, "plans-distinct").status).toBe("error");
    expect(byId(checks, "app-url").status).toBe("warn");
  });
});

describe("evaluateWhopPlan", () => {
  const exp: PlanExpectation = {
    tier: "PRO",
    billing: "monthly",
    planId: "plan_pm",
    expectedProductId: "prod_p",
    displayedPrice: 799,
  };
  const plan: WhopPlanRecord = {
    id: "plan_pm",
    billing_period: 30,
    currency: "try",
    initial_price: 0,
    renewal_price: 799,
    plan_type: "renewal",
    product: { id: "prod_p", title: "CompeteHive Pro" },
    release_method: "buy_now",
    trial_period_days: null,
    visibility: "hidden",
  };

  it("accepts a correctly configured plan", () => {
    const check = evaluateWhopPlan(exp, plan);
    expect(check.status).toBe("ok");
    expect(check.details).toBeUndefined();
  });

  it("errors when the plan belongs to another tier's product", () => {
    const check = evaluateWhopPlan(exp, { ...plan, product: { id: "prod_s", title: "Starter" } });
    expect(check.status).toBe("error");
    expect(check.details?.[0]).toContain("yanlış plana");
  });

  it("errors on a non-TRY currency or a one-time plan", () => {
    expect(evaluateWhopPlan(exp, { ...plan, currency: "usd" }).status).toBe("error");
    expect(
      evaluateWhopPlan(exp, { ...plan, plan_type: "one_time", billing_period: null }).status,
    ).toBe("error");
  });

  it("warns on price, period, setup fee and trial mismatches", () => {
    const check = evaluateWhopPlan(exp, {
      ...plan,
      renewal_price: 899,
      billing_period: 7,
      initial_price: 50,
      trial_period_days: 3,
    });
    expect(check.status).toBe("warn");
    expect(check.details).toHaveLength(4);
  });

  it("expects a 365-day period for yearly plans", () => {
    const yearly: PlanExpectation = { ...exp, billing: "yearly", displayedPrice: 649 * 12 };
    expect(
      evaluateWhopPlan(yearly, { ...plan, billing_period: 365, renewal_price: 7788 }).status,
    ).toBe("ok");
    expect(
      evaluateWhopPlan(yearly, { ...plan, billing_period: 30, renewal_price: 7788 }).status,
    ).toBe("warn");
  });

  it("explains fetch failures by HTTP status", () => {
    expect(planFetchFailedCheck(exp, 404).details?.[0]).toContain("plan yok");
    expect(planFetchFailedCheck(exp, 401).details?.[0]).toContain("WHOP_API_KEY");
  });
});

describe("evaluateWebhookReceipts", () => {
  it("warns when no verified webhook has been recorded yet", () => {
    const checks = evaluateWebhookReceipts({ lastOk: null, lastFail: null }, null);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("warn");
    expect(checks[0].detail).toContain("https://www.competehive.com/api/webhooks/whop");
  });

  it("errors only when a signature failure is newer than the last success", () => {
    const ok = { at: "2026-10-20T10:00:00.000Z", type: "payment.succeeded" };
    const olderFail = { at: "2026-10-19T10:00:00.000Z" };
    const newerFail = { at: "2026-10-21T10:00:00.000Z" };
    expect(evaluateWebhookReceipts({ lastOk: ok, lastFail: olderFail }, null)).toHaveLength(1);
    const failing = evaluateWebhookReceipts({ lastOk: ok, lastFail: newerFail }, null);
    expect(failing.map((c) => c.status)).toEqual(["ok", "error"]);
  });
});
