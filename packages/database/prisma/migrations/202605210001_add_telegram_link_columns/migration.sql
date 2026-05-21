-- Schema drift fix: add Telegram integration columns to "users".
-- These columns exist in packages/database/prisma/schema.prisma (User model)
-- but were never captured in a migration, so production was missing them.
-- Prisma's findUnique on "users" selects every scalar column, so any endpoint
-- that loads the current user (telegram/connect, telegram/status, settings,
-- user/plan, user/features, notifications/unread-count) failed with
-- "column users.telegram_link_token does not exist" -> 500 "Sunucu hatasÄ±".
-- Idempotent (IF NOT EXISTS) so it is safe regardless of partial prior state.

-- Single ALTER TABLE so PostgreSQL takes the metadata lock only once.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "telegram_bot_token" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_bot_username" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_webhook_secret" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_status" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_connected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "telegram_link_token" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_link_token_expires_at" TIMESTAMP(3);

-- @unique in schema: telegram_webhook_secret, telegram_link_token.
-- NOTE: intentionally NOT using CREATE INDEX CONCURRENTLY. Prisma `migrate deploy`
-- runs each migration inside a transaction, and CONCURRENTLY cannot run inside a
-- transaction block (it would abort the migration). The "users" table is small,
-- so the brief write lock during index creation is negligible.
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_webhook_secret_key" ON "users"("telegram_webhook_secret");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_key" ON "users"("telegram_link_token");
