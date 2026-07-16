-- RuleType.COMPETITOR_PRICE_CHANGE — bir rakip fiyat düşürdüğünde/artırdığında
-- tetiklenen uyarı. COMPETITOR_CHEAPER yalnızca "rakip senden ucuz" seviyesini
-- bildirir; bu tip rakibin HER anlamlı fiyat hareketini (yön fark etmeksizin)
-- haber verir. ADD VALUE IF NOT EXISTS ile idempotent: `db push` ile önceden
-- uygulanmış ortamlarda güvenle yeniden oynatılır.

ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'COMPETITOR_PRICE_CHANGE';
