-- Salla special offers (store/feed-fields.ts, 2026-11-23): the connector split
-- them out of coupons into offers[] + amounts.offers_discount. Each connected
-- brand gets the two fields it lacks, after its existing fields — same shape
-- as 0078. Not required, no accepted headers: an upload is never asked for them.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT c."account_id", v."key", v."label", v."type", false, '{}'::text[],
       COALESCE((SELECT MAX(f."sort_order") FROM "store_order_fields" f WHERE f."account_id" = c."account_id"), 0) + v."n"
FROM "store_connections" c
CROSS JOIN (VALUES
  ('offers', 'Offer', 'text', 1),
  ('offers_discount', 'Offer discount (excl. VAT)', 'number', 2)
) AS v("key", "label", "type", "n")
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = c."account_id" AND f."key" = v."key"
);
