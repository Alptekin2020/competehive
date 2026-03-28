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

    console.log("✅ Migrations tamamlandı");
  } catch (err) {
    console.error("❌ Migration hatası:", err);
    throw err;
  } finally {
    await client.end();
  }
}
