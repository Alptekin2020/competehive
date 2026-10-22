-- Herkese açık "Siteniz uyumlu mu?" kontrol kayıtları. IF NOT EXISTS ile
-- idempotent: worker'ın runMigrations() güvenlik ağı aynı tabloyu oluşturur.
CREATE TABLE IF NOT EXISTS "store_checks" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "support" TEXT NOT NULL,
    "issues" JSONB,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "store_checks_domain_idx" ON "store_checks"("domain");

CREATE INDEX IF NOT EXISTS "store_checks_support_created_at_idx" ON "store_checks"("support", "created_at");
