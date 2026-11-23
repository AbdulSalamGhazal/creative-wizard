-- Every order field the Salla feed now fills (store/feed-fields.ts, 2026-11-23):
-- each connected brand gets the ones it lacks, after its existing fields, in
-- the list's order. A brand that already has a key keeps its own row and
-- label. Not required, no accepted headers: an upload is never asked for them.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT c."account_id", v."key", v."label", v."type", false, '{}'::text[],
       COALESCE((SELECT MAX(f."sort_order") FROM "store_order_fields" f WHERE f."account_id" = c."account_id"), 0) + v."n"
FROM "store_connections" c
CROSS JOIN (VALUES
  ('payment_method', 'Payment method', 'text', 1),
  ('payment_type', 'COD or prepaid', 'text', 2),
  ('coupon_code', 'Coupon code', 'text', 3),
  ('coupon_discount', 'Coupon discount (excl. VAT)', 'number', 4),
  ('discount', 'Discount (excl. VAT)', 'number', 5),
  ('subtotal', 'Subtotal (excl. VAT)', 'number', 6),
  ('shipping_fee', 'Shipping (excl. VAT)', 'number', 7),
  ('cod_fee', 'COD fee (excl. VAT)', 'number', 8),
  ('vat', 'VAT', 'number', 9),
  ('city', 'City', 'text', 10),
  ('country', 'Country', 'text', 11),
  ('shipping_company', 'Shipping company', 'text', 12),
  ('tracking_number', 'Tracking number', 'text', 13),
  ('delivered_date', 'Delivered', 'date', 14),
  ('refund_amount', 'Refund amount', 'number', 15),
  ('tags', 'Tags', 'text', 16),
  ('utm_medium', 'UTM medium', 'text', 17),
  ('utm_campaign', 'UTM campaign', 'text', 18),
  ('utm_term', 'UTM term', 'text', 19),
  ('utm_content', 'UTM content', 'text', 20),
  ('salla_source', 'Salla source', 'text', 21),
  ('entry', 'Entry', 'text', 22),
  ('currency', 'Currency', 'text', 23),
  ('exchange_rate', 'Exchange rate', 'number', 24),
  ('salla_customer_id', 'Salla customer ID', 'text', 25)
) AS v("key", "label", "type", "n")
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = c."account_id" AND f."key" = v."key"
);
