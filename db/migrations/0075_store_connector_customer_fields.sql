-- The Salla feed now sends the customer's name, phone and email (personal
-- data opened for Wizard, 2026-11-21). Each connected brand gets the three
-- order fields the feed fills, keyed exactly as Urjwan's uploads already use
-- them (`customer_name`, `phone`) plus `email`. A brand that already has a
-- key keeps its own row and label; only missing keys are added, at the end.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT c."account_id", v."key", v."label", 'text', false, '{}'::text[],
       COALESCE((SELECT MAX(f."sort_order") FROM "store_order_fields" f WHERE f."account_id" = c."account_id"), 0) + v."n"
FROM "store_connections" c
CROSS JOIN (VALUES
  ('customer_name', 'Customer name', 1),
  ('phone', 'Phone', 2),
  ('email', 'Email', 3)
) AS v("key", "label", "n")
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = c."account_id" AND f."key" = v."key"
);
