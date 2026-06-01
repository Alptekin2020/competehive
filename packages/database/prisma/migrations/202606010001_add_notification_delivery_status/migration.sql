-- Adds external-delivery tracking to notifications. Previously a row was written
-- before the email/Telegram/webhook send was attempted and never updated, so the
-- table could not tell whether delivery actually succeeded (and silently-swallowed
-- Telegram failures looked "sent").
--
--   status: SENT | FAILED | SKIPPED  (SKIPPED = channel not configured)
--   error:  failure reason when status = FAILED
--
-- Idempotent (IF NOT EXISTS) and additive with a safe default so existing rows
-- backfill to 'SENT' and replaying on db-push environments is harmless.

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS "error" TEXT;
