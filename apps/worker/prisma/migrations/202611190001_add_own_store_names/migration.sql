-- Kullanıcının kendi mağaza adları (Ayarlar → "Mağaza adım"). IF NOT EXISTS ile
-- idempotent: worker'ın runMigrations() güvenlik ağı aynı kolonu ekler.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "own_store_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
