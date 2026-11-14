// ============================================
// Plana göre tarama sıklığı (worker tarafı)
// ============================================
//
// Satılan vaat: ücretsiz planda günde 1, ücretli planlarda 6 saatte 1 tarama.
// Eskiden 6 saatlik URL turu ve rakip keşif döngüsü plana bakmıyordu — her
// kullanıcı 6 saatte bir yenileniyor, fiyat sayfasındaki fark gerçeği
// yansıtmıyordu (ve ücretsiz kullanıcılar ücretli Serper/OpenAI maliyeti
// üretiyordu).
//
// "Ücretli" tanımı web'deki resolveEffectivePlan'in aynasıdır
// (apps/web/src/lib/plan-resolve.ts): ücretli tier + planStatus ACTIVE +
// süresi (3 günlük toleransla) dolmamış. Geri kalan herkes ücretsiz sayılır.

import { PLAN_EXPIRY_GRACE_MS } from "../shared";

export const PAID_PLANS = ["STARTER", "PRO", "ENTERPRISE"] as const;

export const PAID_REFRESH_AFTER_HOURS = 6;
export const FREE_REFRESH_AFTER_HOURS = 24;

/** Ücretli planların ürün satırındaki tarama aralığı (dakika). */
export const PAID_SCRAPE_INTERVAL_MINUTES = PAID_REFRESH_AFTER_HOURS * 60;

/** Prisma `user` filtresi: şu an fiilen ücretli plandaki kullanıcılar. */
export function paidUserWhere(now: Date) {
  return {
    plan: { in: [...PAID_PLANS] },
    planStatus: "ACTIVE",
    OR: [
      { planExpiresAt: null },
      { planExpiresAt: { gte: new Date(now.getTime() - PLAN_EXPIRY_GRACE_MS) } },
    ],
  };
}

/** Saf karşılığı (test ve tekil kararlar için). */
export function isEffectivelyPaid(
  user: { plan: string | null; planStatus: string | null; planExpiresAt: Date | null },
  now: Date,
): boolean {
  if (!user.plan || !(PAID_PLANS as readonly string[]).includes(user.plan)) return false;
  if (user.planStatus !== "ACTIVE") return false;
  if (user.planExpiresAt && user.planExpiresAt.getTime() + PLAN_EXPIRY_GRACE_MS < now.getTime()) {
    return false;
  }
  return true;
}

/** Bu kullanıcının ürünleri en erken kaç saatte bir yeniden taranır? */
export function refreshAfterHoursFor(
  user: { plan: string | null; planStatus: string | null; planExpiresAt: Date | null },
  now: Date,
): number {
  return isEffectivelyPaid(user, now) ? PAID_REFRESH_AFTER_HOURS : FREE_REFRESH_AFTER_HOURS;
}
