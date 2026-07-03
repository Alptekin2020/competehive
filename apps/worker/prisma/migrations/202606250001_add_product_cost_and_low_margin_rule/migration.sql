-- Kârlılık katmanı: satıcının birim maliyetini (COGS) ve maliyete dayalı
-- LOW_MARGIN uyarı tipini ekler.
--
-- 1) tracked_products.cost — opsiyonel birim maliyet. Kâr (TL), marj (%) ve
--    marj-korumalı fiyat önerisi bu alandan hesaplanır. Mevcut satırlarda NULL
--    kalır (maliyet henüz girilmemiş) ve hiçbir hesaba/uyarıya girmez.
--
-- 2) RuleType.LOW_MARGIN — kâr marjı kullanıcının belirlediği tabanın altına
--    düştüğünde tetiklenen uyarı. ADD VALUE IF NOT EXISTS ile idempotent.
--
-- Her ikisi de additive ve IF NOT EXISTS korumalı: `db push` ile önceden
-- uygulanmış ortamlarda güvenle yeniden oynatılır.

ALTER TABLE "tracked_products"
  ADD COLUMN IF NOT EXISTS "cost" DECIMAL(12, 2);

ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'LOW_MARGIN';
