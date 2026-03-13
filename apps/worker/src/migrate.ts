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

    console.log("✅ Migrations tamamlandı");
  } catch (err) {
    console.error("❌ Migration hatası:", err);
    throw err;
  } finally {
    await client.end();
  }
}
