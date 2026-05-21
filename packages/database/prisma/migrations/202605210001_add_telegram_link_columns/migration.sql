-- Schema drift fix: add Telegram integration columns to "users".
-- These columns exist in packages/database/prisma/schema.prisma (User model)
-- but were never captured in a migration, so production was missing them.
-- Prisma's findUnique on "users" selects every scalar column, so any endpoint
-- that loads the current user (telegram/connect, telegram/status, settings,
-- user/plan, user/features, notifications/unread-count) failed with
-- "column users.telegram_link_token does not exist" -> 500 "Sunucu hatasÄ±".
-- Idempotent (IF NOT EXISTS) so it is safe regardless of partial prior state.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_bot_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_bot_username" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_webhook_secret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_connected_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token_expires_at" TIMESTAMP(3);

-- @unique in schema: telegram_webhook_secret, telegram_link_token
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_webhook_secret_key" ON "users"("telegram_webhook_secret");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_key" ON "users"("telegram_link_token");
