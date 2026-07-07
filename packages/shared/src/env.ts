import { z } from "zod";

// ============================================
// Shared environment schemas
// ============================================

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const webEnvSchema = baseSchema
  .extend({
    CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

    // Optional integrations
    OPENAI_API_KEY: z.string().optional(),
    SERPER_API_KEY: z.string().optional(),
    SENTRY_DSN: z.string().optional(),

    // Optional SMTP
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    // Optional Telegram
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    // Optional Whop billing
    WHOP_API_KEY: z.string().optional(),
    WHOP_WEBHOOK_SECRET: z.string().optional(),
    WHOP_STARTER_PRODUCT_ID: z.string().optional(),
    WHOP_PRO_PRODUCT_ID: z.string().optional(),
    WHOP_ENTERPRISE_PRODUCT_ID: z.string().optional(),
    // Plan ID'lerinin runtime'da okunan öneksiz adları (tercih edilen) ve
    // build'e gömülen NEXT_PUBLIC eşdeğerleri (geriye dönük uyumluluk).
    WHOP_STARTER_PLAN_ID: z.string().optional(),
    WHOP_PRO_PLAN_ID: z.string().optional(),
    WHOP_ENTERPRISE_PLAN_ID: z.string().optional(),
    WHOP_STARTER_YEARLY_PLAN_ID: z.string().optional(),
    WHOP_PRO_YEARLY_PLAN_ID: z.string().optional(),
    WHOP_ENTERPRISE_YEARLY_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_STARTER_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_PRO_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_ENTERPRISE_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_STARTER_YEARLY_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_PRO_YEARLY_PLAN_ID: z.string().optional(),
    NEXT_PUBLIC_WHOP_ENTERPRISE_YEARLY_PLAN_ID: z.string().optional(),

    // Optional admin bootstrap override
    ADMIN_EMAILS: z.string().optional(),
    ADMIN_CLERK_IDS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Yarı yapılandırılmış Whop dağıtımını açılışta yakala: checkout tarafı
    // (plan ID'leri) ayarlanıp webhook eşleme tarafı (product ID) eksikse
    // müşteri ÖDER ama webhook ürünü plana eşleyemez ve yükseltme kaybolur.
    // Bu, ödeme sırasında değil deploy sırasında patlamalı.
    if (env.NODE_ENV !== "production") return;

    const tiers = [
      {
        name: "STARTER",
        planIds: [
          env.WHOP_STARTER_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_STARTER_PLAN_ID,
          env.WHOP_STARTER_YEARLY_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_STARTER_YEARLY_PLAN_ID,
        ],
        productId: env.WHOP_STARTER_PRODUCT_ID,
        productVar: "WHOP_STARTER_PRODUCT_ID",
      },
      {
        name: "PRO",
        planIds: [
          env.WHOP_PRO_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_PRO_PLAN_ID,
          env.WHOP_PRO_YEARLY_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_PRO_YEARLY_PLAN_ID,
        ],
        productId: env.WHOP_PRO_PRODUCT_ID,
        productVar: "WHOP_PRO_PRODUCT_ID",
      },
      {
        name: "ENTERPRISE",
        planIds: [
          env.WHOP_ENTERPRISE_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_ENTERPRISE_PLAN_ID,
          env.WHOP_ENTERPRISE_YEARLY_PLAN_ID,
          env.NEXT_PUBLIC_WHOP_ENTERPRISE_YEARLY_PLAN_ID,
        ],
        productId: env.WHOP_ENTERPRISE_PRODUCT_ID,
        productVar: "WHOP_ENTERPRISE_PRODUCT_ID",
      },
    ];

    const anyPlanConfigured = tiers.some((t) => t.planIds.some(Boolean));
    for (const tier of tiers) {
      if (tier.planIds.some(Boolean) && !tier.productId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [tier.productVar],
          message: `${tier.productVar} is required when a ${tier.name} plan ID is configured — without it the webhook cannot map a paid membership to a plan and paying customers are never upgraded`,
        });
      }
    }
    if (anyPlanConfigured) {
      if (!env.WHOP_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["WHOP_API_KEY"],
          message: "WHOP_API_KEY is required when Whop plan IDs are configured (checkout creation)",
        });
      }
      if (!env.WHOP_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["WHOP_WEBHOOK_SECRET"],
          message:
            "WHOP_WEBHOOK_SECRET is required when Whop plan IDs are configured (webhook verification)",
        });
      }
    }
  });

export const workerEnvSchema = baseSchema
  .extend({
    // Notifications. EMAIL is the only FREE-plan channel, so Resend config is
    // enforced in production via the superRefine below — a prod worker booting
    // without a working sender means the core product promise silently fails.
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    // Optional proxy
    PROXY_HOST: z.string().optional(),
    PROXY_PORT: z.coerce.number().optional(),
    PROXY_USER: z.string().optional(),
    PROXY_PASS: z.string().optional(),

    // Optional monitoring
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .superRefine((env, ctx) => {
    // Keep in sync with apps/worker/src/shared.ts (the worker's Docker build
    // context cannot import this package).
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

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWebEnv(): WebEnv {
  const result = webEnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}

export function validateWorkerEnv(): WorkerEnv {
  const result = workerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}
