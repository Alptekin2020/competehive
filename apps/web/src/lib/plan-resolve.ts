import { PLAN_LIMITS, type PlanTier } from "./plans";

// FREE is a real, usable tier — every signed-in user can track up to this many
// products without a paid subscription. A paid plan that has lapsed (canceled,
// expired, or a non-ACTIVE status) falls back to these same limits.
export const FREE_PLAN_LIMITS = {
  maxProducts: 5,
  refreshIntervalHours: 24,
  displayName: "Ücretsiz",
} as const;

export type EffectivePlan = PlanTier | "FREE";

export interface PlanInfo {
  // True when the user can track products at all. FREE is a usable tier, so
  // this is true for every signed-in user (kept for backwards-compatible
  // callers); use `isPaid` to detect an active paying subscription.
  hasActivePlan: boolean;
  // True only for an active, non-expired paid tier (STARTER/PRO/ENTERPRISE).
  isPaid: boolean;
  plan: EffectivePlan;
  planDisplayName: string;
  maxProducts: number;
  refreshIntervalHours: number;
  expiresAt: Date | null;
}

const PAID_TIERS: ReadonlySet<string> = new Set(["STARTER", "PRO", "ENTERPRISE"]);

export function isPaidTier(plan: string | null | undefined): plan is PlanTier {
  return !!plan && PAID_TIERS.has(plan);
}

export interface PlanUserFields {
  plan: string | null;
  planStatus: string | null;
  planExpiresAt: Date | null;
}

/**
 * Pure resolver: maps a user's stored plan columns to the limits that apply
 * right now. An active, non-expired paid tier yields that tier's limits;
 * everything else (FREE, canceled, expired, unknown) falls back to FREE.
 *
 * Kept free of side effects (no DB access) so it can be unit-tested directly
 * and reused by both the limit check and the plan API.
 */
export function resolveEffectivePlan(
  user: PlanUserFields | null,
  now: Date = new Date(),
): PlanInfo {
  const free: PlanInfo = {
    hasActivePlan: true,
    isPaid: false,
    plan: "FREE",
    planDisplayName: FREE_PLAN_LIMITS.displayName,
    maxProducts: FREE_PLAN_LIMITS.maxProducts,
    refreshIntervalHours: FREE_PLAN_LIMITS.refreshIntervalHours,
    expiresAt: user?.planExpiresAt ?? null,
  };

  if (!user || !isPaidTier(user.plan)) return free;
  if (user.planStatus !== "ACTIVE") return free;
  if (user.planExpiresAt && user.planExpiresAt < now) return free;

  const limits = PLAN_LIMITS[user.plan];
  if (!limits) return free;

  return {
    hasActivePlan: true,
    isPaid: true,
    plan: user.plan,
    planDisplayName: limits.displayName,
    maxProducts: limits.maxProducts,
    refreshIntervalHours: limits.refreshIntervalHours,
    expiresAt: user.planExpiresAt,
  };
}
