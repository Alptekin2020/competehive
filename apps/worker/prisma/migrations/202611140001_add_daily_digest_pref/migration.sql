-- Günlük özet e-postası tercihi (varsayılan açık). IF NOT EXISTS ile
-- idempotent: worker'ın runMigrations() güvenlik ağı aynı kolonu ekler.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_digest_enabled" BOOLEAN NOT NULL DEFAULT true;
