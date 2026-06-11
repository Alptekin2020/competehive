// ============================================
// Per-(rule, product) alert cooldown
// ============================================
//
// AlertRule.lastTriggered kural başına TEK zaman damgasıdır. Genel (hesap
// geneli, trackedProductId=null) kurallarda bu yetmez: ürün A'da tetiklenen
// PRICE_DROP, lastTriggered üzerinden ürün B'nin bildirimini de bastırırdı.
// Bu modül cooldown'u Redis'te (kural, ürün) çifti başına tutar.
//
// Redis erişilemezse eski davranışa (lastTriggered) geri düşülür — genel
// kurallarda bu, ürünler arası bastırma demektir; bildirim kaçırmaktansa
// fazla bastırmak tercih edilir (Redis zaten BullMQ için kritik bağımlılık).

import IORedis from "ioredis";
import { logger } from "./logger";

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      // BullMQ bağlantılarının aksine bu istemci HIZLI HATA vermeli:
      // maxRetriesPerRequest: null olsaydı Redis koptuğunda komutlar sonsuza
      // dek bekler, lastTriggered fallback'i hiç devreye giremez ve
      // alertWorker kilitlenirdi.
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      lazyConnect: true,
    });
  }
  return redis;
}

function cooldownKey(ruleId: string, productId: string): string {
  return `alert-cooldown:${ruleId}:${productId}`;
}

/**
 * Bu kural bu ürün için cooldown'da mı?
 * Redis hatasında null döner — çağıran lastTriggered fallback'ini kullanmalı.
 */
export async function isOnCooldown(ruleId: string, productId: string): Promise<boolean | null> {
  try {
    const exists = await getRedis().exists(cooldownKey(ruleId, productId));
    return exists === 1;
  } catch (error) {
    logger.warn({ error, ruleId, productId }, "Cooldown check failed — falling back");
    return null;
  }
}

/**
 * Tetiklenen kural için (kural, ürün) cooldown'unu başlat.
 * Redis hatası yutulur; lastTriggered güncellemesi (çağıranda) emniyettir.
 */
export async function markCooldown(
  ruleId: string,
  productId: string,
  cooldownMinutes: number,
): Promise<void> {
  const ttlSeconds = Math.max(60, Math.floor(cooldownMinutes * 60));
  try {
    await getRedis().set(cooldownKey(ruleId, productId), "1", "EX", ttlSeconds);
  } catch (error) {
    logger.warn({ error, ruleId, productId }, "Cooldown set failed");
  }
}
