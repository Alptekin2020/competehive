-- Rollout-safe schema catch-up for environments that were baselined before later Prisma models/fields.

-- 1) Ensure tag system tables exist (tags, product_tags) aligned with Prisma schema.
CREATE TABLE IF NOT EXISTS "tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#F59E0B',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_tags" (
    "product_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id", "tag_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tags_user_id_name_key"
ON "tags"("user_id", "name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tags_user_id_fkey'
  ) THEN
    ALTER TABLE "tags"
    ADD CONSTRAINT "tags_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_tags_product_id_fkey'
  ) THEN
    ALTER TABLE "product_tags"
    ADD CONSTRAINT "product_tags_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "tracked_products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_tags_tag_id_fkey'
  ) THEN
    ALTER TABLE "product_tags"
    ADD CONSTRAINT "product_tags_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Ensure competitor AI match columns exist.
ALTER TABLE "competitors"
ADD COLUMN IF NOT EXISTS "match_score" INTEGER;

ALTER TABLE "competitors"
ADD COLUMN IF NOT EXISTS "match_reason" TEXT;

ALTER TABLE "competitors"
ADD COLUMN IF NOT EXISTS "match_attributes" JSONB;
