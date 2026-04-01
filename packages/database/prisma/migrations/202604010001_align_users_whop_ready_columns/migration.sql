-- Align users table to current Whop-ready Prisma schema in rollout-safe, idempotent way.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "whop_user_id" TEXT;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "whop_membership_id" TEXT;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP(3);

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Ensure auth-related expected columns exist in production even if older migrations were skipped.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "clerk_id" TEXT;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "max_products" INTEGER NOT NULL DEFAULT 5;

CREATE UNIQUE INDEX IF NOT EXISTS "users_whop_user_id_key"
ON "users"("whop_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_id_key"
ON "users"("clerk_id");
