import { z } from "zod";

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const workerEnvSchema = baseSchema
  .extend({
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    // Competitor discovery (Serper) and AI product analysis (OpenAI). Optional:
    // the worker boots without them, but the related features no-op/throw a
    // clear error at call time instead of failing with a cryptic upstream 401.
    SERPER_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    PROXY_HOST: z.string().optional(),
    PROXY_PORT: z.coerce.number().optional(),
    PROXY_USER: z.string().optional(),
    PROXY_PASS: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .superRefine((env, ctx) => {
    // E-posta, FREE planın TEK bildirim kanalı: prod'da eksik/yanlış e-posta
    // yapılandırması ürünün temel vaadinin sessizce çalışmaması demektir.
    // Boot'ta yüksek sesle patlamak, aylarca fark edilmeyen "SENT görünen ama
    // hiç ulaşmayan" e-postalardan iyidir.
    if (env.NODE_ENV !== "production") return;
    if (!env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required in production (EMAIL is the only FREE-plan channel)",
      });
    }
    if (!env.RESEND_FROM_EMAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_FROM_EMAIL"],
        message: "RESEND_FROM_EMAIL is required in production",
      });
    } else if (env.RESEND_FROM_EMAIL.includes("resend.dev")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_FROM_EMAIL"],
        message:
          "RESEND_FROM_EMAIL must be a sender on a verified custom domain — the resend.dev onboarding address cannot deliver to customers",
      });
    }
  });

export function validateWorkerEnv() {
  const result = workerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}

export const SUPPORTED_SCRAPER_MARKETPLACES = [
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
] as const;

export type SupportedScraperMarketplace = (typeof SUPPORTED_SCRAPER_MARKETPLACES)[number];

export interface AlertUser {
  id: string;
  email: string;
  telegramChatId: string | null;
  telegramStatus: string | null;
  webhookUrl: string | null;
  emailAlertsEnabled: boolean;
  plan: string | null;
  planStatus: string | null;
  planExpiresAt: Date | null;
}

// ---- Plan → bildirim kanalı politikası ----
// apps/web/src/lib/plan-resolve.ts + plan-gates.ts'in aynası; senkron tutulmalı
// (worker'ın Docker build context'i shared/web paketlerini import edemez).
// Kural oluşturma anında web API kanalı zaten kapılar; buradaki send-time
// kontrolü, plan DÜŞTÜKTEN sonra eski kurallarda kalan ücretli kanalların
// süresiz çalışmaya devam etmesini engeller.
export const PLAN_EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const CHANNELS_BY_TIER: Record<string, string[]> = {
  STARTER: ["EMAIL", "TELEGRAM"],
  PRO: ["EMAIL", "TELEGRAM", "WEBHOOK"],
  ENTERPRISE: ["EMAIL", "TELEGRAM", "WEBHOOK"],
};

export function resolveAllowedChannels(
  user: Pick<AlertUser, "plan" | "planStatus" | "planExpiresAt">,
  now: Date = new Date(),
): string[] {
  const paidChannels = user.plan ? CHANNELS_BY_TIER[user.plan] : undefined;
  if (!paidChannels) return ["EMAIL"];
  if (user.planStatus !== "ACTIVE") return ["EMAIL"];
  if (user.planExpiresAt && user.planExpiresAt.getTime() + PLAN_EXPIRY_GRACE_MS < now.getTime()) {
    return ["EMAIL"];
  }
  return paidChannels;
}

export interface AlertRuleWithUser {
  id: string;
  userId: string;
  ruleType: string;
  notifyVia: string[];
  user: AlertUser;
  trackedProduct: {
    productName: string;
    marketplace: string;
    productUrl: string;
  } | null;
}
