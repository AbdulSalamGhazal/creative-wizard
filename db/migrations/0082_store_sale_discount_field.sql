-- Salla sale prices (store/feed-fields.ts, 2026-11-23): the connector sends
-- amounts.sale_discount, the order's markdown below the products' regular
-- prices (excl. VAT; apart from coupons and offers). Each connected brand gets
-- the field if it lacks it, after its existing fields — same shape as 0078.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT c."account_id", v."key", v."label", v."type", false, '{}'::text[],
       COALESCE((SELECT MAX(f."sort_order") FROM "store_order_fields" f WHERE f."account_id" = c."account_id"), 0) + v."n"
FROM "store_connections" c
CROSS JOIN (VALUES
  ('sale_discount', 'Sale discount (excl. VAT)', 'number', 1)
) AS v("key", "label", "type", "n")
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = c."account_id" AND f."key" = v."key"
);
