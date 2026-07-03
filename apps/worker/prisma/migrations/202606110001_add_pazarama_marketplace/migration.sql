-- Pazarama marketplace desteği: Marketplace enum'una PAZARAMA değeri eklenir.
-- IF NOT EXISTS ile idempotent — worker boot reconciliation'ı da aynı değeri
-- güvenle ekleyebilir.
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'PAZARAMA';
