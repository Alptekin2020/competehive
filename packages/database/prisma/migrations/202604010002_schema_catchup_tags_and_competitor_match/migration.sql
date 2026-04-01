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

-- Normalize FK column types to whatever existing baseline tables currently use
-- (some production databases still have UUID ids from older pre-Prisma baselines).
DO $$
DECLARE
  users_id_udt TEXT;
  tracked_products_id_udt TEXT;
BEGIN
  SELECT c.udt_name INTO users_id_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'users' AND c.column_name = 'id';

  IF users_id_udt = 'uuid' THEN
    ALTER TABLE "tags" ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid;
  ELSE
    ALTER TABLE "tags" ALTER COLUMN "user_id" TYPE TEXT USING "user_id"::text;
  END IF;

  SELECT c.udt_name INTO tracked_products_id_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'tracked_products' AND c.column_name = 'id';

  IF tracked_products_id_udt = 'uuid' THEN
    ALTER TABLE "product_tags" ALTER COLUMN "product_id" TYPE UUID USING "product_id"::uuid;
  ELSE
    ALTER TABLE "product_tags" ALTER COLUMN "product_id" TYPE TEXT USING "product_id"::text;
  END IF;
END $$;

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
