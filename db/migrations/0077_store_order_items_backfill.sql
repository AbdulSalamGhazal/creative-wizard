-- Fill `store_order_items` for the orders the Salla feed already delivered,
-- from the raw log: for each feed-held order, the lines of its LATEST event
-- (occurred_at, then received_at). Same rules as the ingest mapping
-- (lib/connector/map-order.ts): a line with no numeric quantity is skipped, a
-- fractional quantity rounds, the line total is converted to SAR with the
-- order's exchange_rate (1 for SAR or no currency; NULL for a foreign order
-- without a usable rate). Only orders with no lines yet are filled, so running
-- after the new ingest has written lines changes nothing.
WITH latest AS (
  SELECT DISTINCT ON (e."account_id", e."payload" #>> '{data,order,reference}')
    e."account_id",
    e."payload" #>> '{data,order,reference}' AS ref,
    e."payload" #> '{data,order}' AS o
  FROM "store_connector_events" e
  WHERE e."account_id" IS NOT NULL
    AND e."type" LIKE 'order.%'
    AND e."payload" #>> '{data,order,reference}' IS NOT NULL
  ORDER BY e."account_id", e."payload" #>> '{data,order,reference}',
           e."occurred_at" DESC NULLS LAST, e."received_at" DESC
),
orders AS (
  SELECT so."id" AS store_order_id, so."account_id", l.o,
    CASE
      WHEN NULLIF(UPPER(TRIM(l.o ->> 'currency')), '') IS NULL OR UPPER(TRIM(l.o ->> 'currency')) = 'SAR' THEN 1::numeric
      WHEN jsonb_typeof(l.o -> 'exchange_rate') = 'number' AND (l.o ->> 'exchange_rate')::numeric > 0 THEN (l.o ->> 'exchange_rate')::numeric
      ELSE NULL
    END AS rate
  FROM latest l
  JOIN "store_orders" so ON so."account_id" = l."account_id" AND so."order_id" = l.ref
  WHERE so."connector_updated_at" IS NOT NULL
    AND jsonb_typeof(l.o -> 'items') = 'array'
    AND NOT EXISTS (SELECT 1 FROM "store_order_items" i WHERE i."store_order_id" = so."id")
),
lines AS (
  SELECT o.store_order_id, o."account_id", o.rate, (it.ord - 1)::int AS position, it.line
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(o.o -> 'items') WITH ORDINALITY AS it(line, ord)
  WHERE it.ord <= 200 AND jsonb_typeof(it.line) = 'object'
)
INSERT INTO "store_order_items" ("account_id", "store_order_id", "position", "sku", "name", "quantity", "line_total_sar")
SELECT
  "account_id", store_order_id, position,
  LEFT(NULLIF(TRIM(line ->> 'sku'), ''), 128),
  LEFT(NULLIF(TRIM(line ->> 'name'), ''), 500),
  ROUND((line ->> 'quantity')::numeric)::int,
  CASE
    WHEN rate IS NOT NULL AND jsonb_typeof(line -> 'total') = 'number'
      THEN ROUND((line ->> 'total')::numeric * rate, 2)
    ELSE NULL
  END
FROM lines
WHERE jsonb_typeof(line -> 'quantity') = 'number';
