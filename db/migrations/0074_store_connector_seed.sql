-- Link the three Salla stores of the Urjwan Connector to their brands. Keyed
-- by account id and guarded by EXISTS, so a database without a given brand
-- (local dev has only the default account) simply links fewer stores.
INSERT INTO "store_connections" ("account_id", "store_key")
SELECT a."id", v."store_key"
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'urjwan'),
  ('078573b3-0c9d-4b49-9582-90cea06687f6'::uuid, 'misbah'),
  ('0d47ec45-5a9d-459f-8762-b21559c12691'::uuid, 'urjwan_brush')
) AS v("account_id", "store_key")
JOIN "accounts" a ON a."id" = v."account_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The one field the feed adds to the Orders table: the order's status as
-- Salla reports it. Named "Salla status" so it can't be confused with a
-- status column a brand already uploads from its exports.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT c."account_id", 'order_status', 'Salla status',
       'text', false, '{}'::text[],
       COALESCE((SELECT MAX(f."sort_order") + 1 FROM "store_order_fields" f WHERE f."account_id" = c."account_id"), 0)
FROM "store_connections" c
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = c."account_id" AND f."key" = 'order_status'
);
