ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "clerk_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_id_key"
ON "users"("clerk_id");
