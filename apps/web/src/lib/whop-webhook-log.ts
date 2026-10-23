import redis from "@/lib/redis";
import type { WebhookReceipt } from "@/lib/whop-config-check";

// Whop webhook teslimat izi: yönetici "Ödeme Ayarları" sayfası, Whop panelindeki
// webhook adresinin/secret'ının doğru olup olmadığını buradan anlar (Vercel
// Hobby logları yalnızca 1 saat tutar). Yalnızca zaman + event türü saklanır —
// payload/kişisel veri yok. Redis yoksa sessizce atlanır; webhook akışını asla
// bozmaz.
const LAST_OK_KEY = "whop:webhook:last-ok";
const LAST_FAIL_KEY = "whop:webhook:last-fail";
const RECEIPT_TTL_SEC = 90 * 24 * 60 * 60;

export async function recordWebhookReceipt(outcome: "ok" | "fail", type?: string): Promise<void> {
  const receipt: WebhookReceipt = { at: new Date().toISOString(), ...(type ? { type } : {}) };
  try {
    await redis.set(
      outcome === "ok" ? LAST_OK_KEY : LAST_FAIL_KEY,
      JSON.stringify(receipt),
      "EX",
      RECEIPT_TTL_SEC,
    );
  } catch (redisError) {
    console.warn("[whop] webhook receipt not recorded (redis): " + String(redisError));
  }
}

function parseReceipt(raw: string | null): WebhookReceipt | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WebhookReceipt;
    return typeof parsed?.at === "string" ? parsed : null;
  } catch (parseError) {
    console.warn("[whop] malformed webhook receipt: " + String(parseError));
    return null;
  }
}

export async function readWebhookReceipts(): Promise<{
  lastOk: WebhookReceipt | null;
  lastFail: WebhookReceipt | null;
}> {
  const [ok, fail] = await redis.mget(LAST_OK_KEY, LAST_FAIL_KEY);
  return { lastOk: parseReceipt(ok), lastFail: parseReceipt(fail) };
}
