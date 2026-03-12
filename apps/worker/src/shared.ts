import { z } from "zod";

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const workerEnvSchema = baseSchema.extend({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PROXY_HOST: z.string().optional(),
  PROXY_PORT: z.coerce.number().optional(),
  PROXY_USER: z.string().optional(),
  PROXY_PASS: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
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
  webhookUrl: string | null;
}

export interface AlertRuleWithUser {
  id: string;
  notifyVia: string[];
  user: AlertUser;
  trackedProduct: {
    productName: string;
    marketplace: string;
    productUrl: string;
  } | null;
}
