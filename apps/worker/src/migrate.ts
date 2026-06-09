import { Client } from "pg";

export async function runMigrations() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id"        TEXT PRIMARY KEY,
        "email"     TEXT NOT NULL UNIQUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Product" (
        "id"        TEXT PRIMARY KEY,
        "userId"    TEXT NOT NULL,
        "title"     TEXT NOT NULL,
        "url"       TEXT NOT NULL,
        "imageUrl"  TEXT,
        "price"     DOUBLE PRECISION,
        "currency"  TEXT NOT NULL DEFAULT 'TRY',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Competitors table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Competitor" (
        "id"          TEXT PRIMARY KEY,
        "productId"   TEXT NOT NULL,
        "title"       TEXT NOT NULL,
        "price"       DOUBLE PRECISION NOT NULL,
        "currency"    TEXT NOT NULL DEFAULT 'TRY',
        "link"        TEXT NOT NULL,
        "imageUrl"    TEXT,
        "retailer"    TEXT NOT NULL DEFAULT 'Diğer',
        "lastSeenAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // PriceHistory table — ana hedef
    await client.query(`
      CREATE TABLE IF NOT EXISTS "PriceHistory" (
        "id"         TEXT PRIMARY KEY,
        "productId"  TEXT NOT NULL,
        "retailer"   TEXT NOT NULL,
        "price"      DOUBLE PRECISION NOT NULL,
        "currency"   TEXT NOT NULL DEFAULT 'TRY',
        "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_history_product
      ON "PriceHistory"("productId")
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_history_recorded
      ON "PriceHistory"("productId", "recordedAt" DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_competitor_product
      ON "Competitor"("productId")
    `);

    // Unique constraint — aynı URL'den mükerrer competitor engelle
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_unique
      ON "Competitor"("productId", "link")
    `);

    // Step 1.4: Refresh status tracking
    await client.query(`
      ALTER TABLE "tracked_products"
      ADD COLUMN IF NOT EXISTS "refresh_status" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "tracked_products"
      ADD COLUMN IF NOT EXISTS "refresh_requested_at" TIMESTAMPTZ DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "tracked_products"
      ADD COLUMN IF NOT EXISTS "refresh_completed_at" TIMESTAMPTZ DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "tracked_products"
      ADD COLUMN IF NOT EXISTS "refresh_error" TEXT DEFAULT NULL
    `);

    console.log("✅ Step 1.4 migration: refresh status columns added");

    // Step 3.1: New marketplace enum values
    // PostgreSQL ALTER TYPE ADD VALUE is idempotent with IF NOT EXISTS
    await client.query(`ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'TEKNOSA'`);
    await client.query(`ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'VATAN'`);
    await client.query(`ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'DECATHLON'`);
    await client.query(`ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'MEDIAMARKT'`);

    console.log("✅ Step 3.1 migration: new marketplace enum values added");

    // Step 3.2: AI match quality columns
    await client.query(`
      ALTER TABLE "competitors"
      ADD COLUMN IF NOT EXISTS "match_score" INTEGER DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "competitors"
      ADD COLUMN IF NOT EXISTS "match_reason" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "competitors"
      ADD COLUMN IF NOT EXISTS "match_attributes" JSONB DEFAULT NULL
    `);

    console.log("✅ Step 3.2 migration: match quality columns added");

    // Step 4.3: Tags system
    await client.query(`
      CREATE TABLE IF NOT EXISTS "tags" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "name" TEXT NOT NULL,
        "color" TEXT NOT NULL DEFAULT '#F59E0B',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "tags_user_id_name_key"
      ON "tags"("user_id", "name")
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "product_tags" (
        "product_id" UUID NOT NULL,
        "tag_id" UUID NOT NULL,
        CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id", "tag_id"),
        CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE,
        CONSTRAINT "product_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
      )
    `);

    console.log("✅ Step 4.3 migration: tags system tables created");

    // Step 5.2: Whop membership tracking
    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "whop_user_id" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "whop_membership_id" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP DEFAULT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_whop_user_id_key"
      ON "users"("whop_user_id")
    `);

    console.log("✅ Step 5.2 migration: whop membership fields added");

    // Phase 6: Performance indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_tracked_products_user_status"
      ON "tracked_products"("user_id", "status")
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_price_history_product_scraped"
      ON "price_history"("tracked_product_id", "scraped_at" DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_competitors_product_marketplace"
      ON "competitors"("tracked_product_id", "marketplace")
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_alert_rules_user_active"
      ON "alert_rules"("user_id", "is_active")
      WHERE "is_active" = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
      ON "notifications"("user_id", "sent_at" DESC)
      WHERE "is_read" = false
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_tags_user"
      ON "tags"("user_id")
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_tags_tag"
      ON "product_tags"("tag_id")
    `);

    console.log("✅ Phase 6 migration: performance indexes added");

    // Phase 7: Per-user Telegram bot integration
    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_bot_token" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_bot_username" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_webhook_secret" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_status" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_connected_at" TIMESTAMPTZ DEFAULT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_webhook_secret_key"
      ON "users"("telegram_webhook_secret")
      WHERE "telegram_webhook_secret" IS NOT NULL
    `);

    console.log("✅ Phase 7 migration: Telegram per-user bot fields added");

    // Phase 8: Central bot — link tokens
    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_link_token" TEXT DEFAULT NULL
    `);

    await client.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "telegram_link_token_expires_at" TIMESTAMP DEFAULT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_key"
      ON "users"("telegram_link_token")
      WHERE "telegram_link_token" IS NOT NULL
    `);

    console.log("✅ Phase 8 migration: Telegram link token fields added");

    // Phase 9: Plan limit enforcement (Whop subscription tracking).
    // Single ALTER TABLE so PostgreSQL takes the metadata lock only once.
    await client.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "plan_status" TEXT,
        ADD COLUMN IF NOT EXISTS "whop_product_id" TEXT,
        ADD COLUMN IF NOT EXISTS "whop_plan_id" TEXT
    `);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_whop_membership_id_key" ON "users"("whop_membership_id")`,
    );

    console.log("✅ Phase 9 migration: plan limit enforcement fields added");

    // Phase 10: Notification + alert-flow schema reconciliation.
    // GET /api/notifications 500s when the live `notifications` table is missing
    // columns the Prisma schema (model Notification) declares — most often
    // `status`/`error` (added by 202606010001) on a DB that hasn't redeployed.
    // The statements below idempotently force-align the live schema with
    // packages/database/prisma/schema.prisma, independent of Prisma's migration
    // state. Types/defaults mirror 0001_initial_baseline +
    // 202606010001_add_notification_delivery_status + 202605300001_add_email_alert_pref_columns.

    // (a) Full table — safety net if `notifications` is entirely missing.
    await client.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id"            TEXT NOT NULL,
        "user_id"       TEXT NOT NULL,
        "alert_rule_id" TEXT,
        "channel"       "NotifyChannel" NOT NULL,
        "title"         TEXT NOT NULL,
        "message"       TEXT NOT NULL,
        "metadata"      JSONB,
        "status"        TEXT NOT NULL DEFAULT 'SENT',
        "error"         TEXT,
        "is_read"       BOOLEAN NOT NULL DEFAULT false,
        "sent_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
      )
    `);

    // (b) Per-column backfill — table exists but a column is missing. Each ADD is
    // crash-safe on a non-empty table: defaulted columns carry their default, the
    // rest are added nullable (the canonical NOT NULLs live in the CREATE TABLE).
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "id" TEXT`);
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "user_id" TEXT`);
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "alert_rule_id" TEXT`);
    await client.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "channel" "NotifyChannel"`,
    );
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" TEXT`);
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "message" TEXT`);
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" JSONB`);
    await client.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SENT'`,
    );
    await client.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "error" TEXT`);
    await client.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "is_read" BOOLEAN NOT NULL DEFAULT false`,
    );
    await client.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    );

    // (c) users columns the notification/alert flow reads (model User).
    await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" TEXT`);
    await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_status" TEXT`);
    await client.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_alerts_enabled" BOOLEAN NOT NULL DEFAULT true`,
    );
    await client.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "alert_threshold_pct" DOUBLE PRECISION NOT NULL DEFAULT 5`,
    );

    // (d) Lookup indexes. NOTE: model Notification has no `created_at` — its
    // timestamp column is `sent_at` (the route's orderBy), so the time index
    // targets sent_at; indexing a non-existent created_at would abort migration.
    await client.query(
      `CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications"("user_id")`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "idx_notifications_sent_at" ON "notifications"("sent_at")`,
    );

    console.log("✅ Phase 10 migration: notification schema reconciled");

    console.log("✅ Migrations tamamlandı");
  } catch (err) {
    console.error("❌ Migration hatası:", err);
    throw err;
  } finally {
    await client.end();
  }
}
