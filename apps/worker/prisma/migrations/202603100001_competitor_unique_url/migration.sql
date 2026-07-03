-- Prevent duplicate competitors per tracked product and URL
WITH ranked_competitors AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tracked_product_id, competitor_url
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM competitors
)
DELETE FROM competitors
WHERE id IN (
  SELECT id
  FROM ranked_competitors
  WHERE rn > 1
);

ALTER TABLE "competitors"
ADD CONSTRAINT "competitors_tracked_product_id_competitor_url_key"
UNIQUE ("tracked_product_id", "competitor_url");
