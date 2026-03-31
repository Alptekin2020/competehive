ALTER TABLE "tracked_products"
ADD COLUMN IF NOT EXISTS "refresh_status" TEXT;

ALTER TABLE "tracked_products"
ADD COLUMN IF NOT EXISTS "refresh_requested_at" TIMESTAMP(3);

ALTER TABLE "tracked_products"
ADD COLUMN IF NOT EXISTS "refresh_completed_at" TIMESTAMP(3);

ALTER TABLE "tracked_products"
ADD COLUMN IF NOT EXISTS "refresh_error" TEXT;
