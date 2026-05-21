import { Client } from "pg";
import "dotenv/config";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not set");
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log("✅ Connected to Railway DB");

  // Phase 7: Per-user Telegram bot integration (eski mimariden kalan kolonlar)
  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_bot_token" TEXT DEFAULT NULL`,
  );
  console.log("✅ telegram_bot_token");

  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_bot_username" TEXT DEFAULT NULL`,
  );
  console.log("✅ telegram_bot_username");

  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_webhook_secret" TEXT DEFAULT NULL`,
  );
  console.log("✅ telegram_webhook_secret");

  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_status" TEXT DEFAULT NULL`,
  );
  console.log("✅ telegram_status");

  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_connected_at" TIMESTAMP DEFAULT NULL`,
  );
  console.log("✅ telegram_connected_at");

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_webhook_secret_key"
    ON "users"("telegram_webhook_secret")
    WHERE "telegram_webhook_secret" IS NOT NULL
  `);
  console.log("✅ users_telegram_webhook_secret_key index");

  // Phase 8: Central bot — link tokens
  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token" TEXT DEFAULT NULL`,
  );
  console.log("✅ telegram_link_token");

  await client.query(
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token_expires_at" TIMESTAMP DEFAULT NULL`,
  );
  console.log("✅ telegram_link_token_expires_at");

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_key"
    ON "users"("telegram_link_token")
    WHERE "telegram_link_token" IS NOT NULL
  `);
  console.log("✅ users_telegram_link_token_key index");

  // Doğrulama
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name LIKE 'telegram%'
    ORDER BY column_name
  `);
  console.log("\n📋 users tablosundaki telegram kolonları:");
  result.rows.forEach((row) => console.log(`   - ${row.column_name}`));

  await client.end();
  console.log("\n✅ Tüm migration'lar tamamlandı");
}

main().catch((err) => {
  console.error("❌ Migration hatası:", err);
  process.exit(1);
});
