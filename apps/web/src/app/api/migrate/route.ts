import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const maxDuration = 60;

export async function GET() {
  const prisma = new PrismaClient();
  const results: string[] = [];

  try {
    // ENUM Types - her biri ayrı
    const enums = [
      `DO $$ BEGIN CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "Marketplace" AS ENUM ('TRENDYOL', 'HEPSIBURADA', 'AMAZON_TR', 'N11', 'SHOPIFY', 'CUSTOM'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'OUT_OF_STOCK'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "RuleType" AS ENUM ('PRICE_DROP', 'PRICE_INCREASE', 'PRICE_THRESHOLD', 'PERCENTAGE_CHANGE', 'COMPETITOR_CHEAPER', 'OUT_OF_STOCK', 'BACK_IN_STOCK'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "NotifyChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WEBHOOK'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    ];

    for (const sql of enums) {
      await prisma.$executeRawUnsafe(sql);
    }
    results.push("ENUMs created");

    // Users
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "name" TEXT,
        "plan" "Plan" NOT NULL DEFAULT 'FREE',
        "max_products" INTEGER NOT NULL DEFAULT 5,
        "telegram_chat_id" VARCHAR(50),
        "webhook_url" TEXT,
        "stripe_customer_id" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "users_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email")`);
    results.push("users table created");

    // API Keys
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "api_keys" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "last_used" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_key" ON "api_keys"("key")`);
    results.push("api_keys table created");

    // Tracked Products
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "tracked_products" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "product_name" TEXT NOT NULL,
        "marketplace" "Marketplace" NOT NULL,
        "product_url" TEXT NOT NULL,
        "product_image" TEXT,
        "seller_name" TEXT,
        "category" TEXT,
        "current_price" DECIMAL(12,2),
        "currency" TEXT NOT NULL DEFAULT 'TRY',
        "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
        "last_scraped_at" TIMESTAMP(3),
        "scrape_interval" INTEGER NOT NULL DEFAULT 60,
        "metadata" JSONB,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "tracked_products_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "tracked_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "tracked_products_user_id_marketplace_idx" ON "tracked_products"("user_id", "marketplace")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "tracked_products_status_last_scraped_at_idx" ON "tracked_products"("status", "last_scraped_at")`);
    results.push("tracked_products table created");

    // Price History
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "price_history" (
        "id" BIGSERIAL NOT NULL,
        "tracked_product_id" UUID NOT NULL,
        "price" DECIMAL(12,2) NOT NULL,
        "previous_price" DECIMAL(12,2),
        "currency" TEXT NOT NULL DEFAULT 'TRY',
        "price_change" DECIMAL(12,2),
        "price_change_pct" DECIMAL(8,4),
        "in_stock" BOOLEAN NOT NULL DEFAULT true,
        "seller_name" TEXT,
        "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "price_history_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "price_history_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "price_history_tracked_product_id_scraped_at_idx" ON "price_history"("tracked_product_id", "scraped_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "price_history_scraped_at_idx" ON "price_history"("scraped_at")`);
    results.push("price_history table created");

    // Competitors
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "competitors" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "tracked_product_id" UUID NOT NULL,
        "competitor_url" TEXT NOT NULL,
        "competitor_name" TEXT,
        "marketplace" "Marketplace" NOT NULL,
        "current_price" DECIMAL(12,2),
        "last_scraped_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "competitors_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "competitors_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE
      )
    `);
    results.push("competitors table created");

    // Competitor Prices
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "competitor_prices" (
        "id" BIGSERIAL NOT NULL,
        "competitor_id" UUID NOT NULL,
        "price" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'TRY',
        "in_stock" BOOLEAN NOT NULL DEFAULT true,
        "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "competitor_prices_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "competitor_prices_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "competitor_prices_competitor_id_scraped_at_idx" ON "competitor_prices"("competitor_id", "scraped_at")`);
    results.push("competitor_prices table created");

    // Alert Rules
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "alert_rules" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "tracked_product_id" UUID,
        "rule_type" "RuleType" NOT NULL,
        "threshold_value" DECIMAL(12,2),
        "direction" TEXT,
        "notify_via" "NotifyChannel"[] NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "last_triggered" TIMESTAMP(3),
        "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "alert_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "alert_rules_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE
      )
    `);
    results.push("alert_rules table created");

    // Notifications
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "alert_rule_id" UUID,
        "channel" "NotifyChannel" NOT NULL,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "metadata" JSONB,
        "is_read" BOOLEAN NOT NULL DEFAULT false,
        "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "notifications_alert_rule_id_fkey" FOREIGN KEY ("alert_rule_id") REFERENCES "alert_rules"("id") ON DELETE SET NULL
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read")`);
    results.push("notifications table created");

    // Scrape Jobs
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "scrape_jobs" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "tracked_product_id" UUID NOT NULL,
        "marketplace" "Marketplace" NOT NULL,
        "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "result" JSONB,
        "error" TEXT,
        "started_at" TIMESTAMP(3),
        "completed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "scrape_jobs_status_created_at_idx" ON "scrape_jobs"("status", "created_at")`);
    results.push("scrape_jobs table created");

    // System Logs
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "system_logs" (
        "id" BIGSERIAL NOT NULL,
        "level" TEXT NOT NULL,
        "service" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "metadata" JSONB,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at")`);
    results.push("system_logs table created");

    // Doğrulama
    const tables: any = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    await prisma.$disconnect();

    return NextResponse.json({
      success: true,
      message: "Tüm tablolar başarıyla oluşturuldu!",
      steps: results,
      tables: tables.map((t: any) => t.table_name),
    });
  } catch (error: any) {
    await prisma.$disconnect();
    return NextResponse.json({
      success: false,
      completedSteps: results,
      error: error.message,
    }, { status: 500 });
  }
}
