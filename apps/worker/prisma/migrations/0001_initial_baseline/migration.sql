-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('TRENDYOL', 'HEPSIBURADA', 'AMAZON_TR', 'N11', 'CICEKSEPETI', 'PTTAVM', 'AKAKCE', 'CIMRI', 'EPEY', 'BOYNER', 'GRATIS', 'WATSONS', 'KITAPYURDU', 'DECATHLON', 'TEKNOSA', 'MEDIAMARKT', 'SEPHORA', 'KOCTAS', 'VATAN', 'ITOPYA', 'SHOPIFY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('PRICE_DROP', 'PRICE_INCREASE', 'PRICE_THRESHOLD', 'PERCENTAGE_CHANGE', 'COMPETITOR_CHEAPER', 'OUT_OF_STOCK', 'BACK_IN_STOCK');

-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "max_products" INTEGER NOT NULL DEFAULT 5,
    "telegram_chat_id" TEXT,
    "webhook_url" TEXT,
    "stripe_customer_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_products" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
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
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" BIGSERIAL NOT NULL,
    "tracked_product_id" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "previous_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "price_change" DECIMAL(12,2),
    "price_change_pct" DECIMAL(8,4),
    "in_stock" BOOLEAN NOT NULL DEFAULT true,
    "seller_name" TEXT,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "tracked_product_id" TEXT NOT NULL,
    "competitor_url" TEXT NOT NULL,
    "competitor_name" TEXT,
    "marketplace" "Marketplace" NOT NULL,
    "current_price" DECIMAL(12,2),
    "last_scraped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_prices" (
    "id" BIGSERIAL NOT NULL,
    "competitor_id" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "in_stock" BOOLEAN NOT NULL DEFAULT true,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tracked_product_id" TEXT,
    "rule_type" "RuleType" NOT NULL,
    "threshold_value" DECIMAL(12,2),
    "direction" TEXT,
    "notify_via" "NotifyChannel"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered" TIMESTAMP(3),
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alert_rule_id" TEXT,
    "channel" "NotifyChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" TEXT NOT NULL,
    "tracked_product_id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" BIGSERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "tracked_products_user_id_marketplace_idx" ON "tracked_products"("user_id", "marketplace");

-- CreateIndex
CREATE INDEX "tracked_products_status_last_scraped_at_idx" ON "tracked_products"("status", "last_scraped_at");

-- CreateIndex
CREATE INDEX "price_history_tracked_product_id_scraped_at_idx" ON "price_history"("tracked_product_id", "scraped_at");

-- CreateIndex
CREATE INDEX "price_history_scraped_at_idx" ON "price_history"("scraped_at");

-- CreateIndex
CREATE INDEX "competitor_prices_competitor_id_scraped_at_idx" ON "competitor_prices"("competitor_id", "scraped_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "scrape_jobs_status_created_at_idx" ON "scrape_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_products" ADD CONSTRAINT "tracked_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_prices" ADD CONSTRAINT "competitor_prices_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_tracked_product_id_fkey" FOREIGN KEY ("tracked_product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_rule_id_fkey" FOREIGN KEY ("alert_rule_id") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
