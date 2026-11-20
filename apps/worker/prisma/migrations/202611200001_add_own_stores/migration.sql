-- Pazaryeri başına kendi mağaza adı (Ayarlar → "Mağaza adım"): {"TRENDYOL": "…"}.
-- own_store_names (tüm pazaryerleri) yedek olarak kalır. IF NOT EXISTS ile
-- idempotent: worker'ın runMigrations() güvenlik ağı aynı kolonu ekler.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "own_stores" JSONB NOT NULL DEFAULT '{}'::jsonb;
