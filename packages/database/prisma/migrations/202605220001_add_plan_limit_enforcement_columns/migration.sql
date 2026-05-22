-- Plan limit enforcement: capture subscription state from Whop webhooks
-- so server-side checks (canAddProduct) can gate product creation by plan.
--
-- Adds:
--   plan_status      — 'ACTIVE' | 'EXPIRED' | 'CANCELED' | null
--   whop_product_id  — Whop access pass id (used to map to PlanTier)
--   whop_plan_id     — Whop billing plan id (informational)
--
-- Also promotes whop_membership_id to a unique index (was nullable text).
-- PostgreSQL unique indexes treat NULLs as distinct, so existing users
-- without a membership stay compatible.
--
-- Idempotent (IF NOT EXISTS) so partial rollouts are safe to replay.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "plan_status" TEXT,
  ADD COLUMN IF NOT EXISTS "whop_product_id" TEXT,
  ADD COLUMN IF NOT EXISTS "whop_plan_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_whop_membership_id_key"
  ON "users"("whop_membership_id");
