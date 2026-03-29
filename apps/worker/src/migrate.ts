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

    console.log("✅ Migrations tamamlandı");
  } catch (err) {
    console.error("❌ Migration hatası:", err);
    throw err;
  } finally {
    await client.end();
  }
}
