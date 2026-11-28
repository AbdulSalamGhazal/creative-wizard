-- 2026-11-28: the time an order was placed, for every order the Salla feed
-- already holds. Every feed event is kept whole, so the newest event of each
-- order carries its `created_at`. Read it exactly the way the mapper does
-- (lib/connector/map-order.ts): a Riyadh wall time, with "+03:00" or no zone;
-- any other zone, or a bare date, leaves ordered_at NULL. Orders only a file
-- has written keep NULL — a file has the day, never the time.
UPDATE "store_orders" o
SET "ordered_at" = (
  replace(regexp_replace(e.created_at, '\s?\+03:?00$', ''), 'T', ' ')::timestamp
  AT TIME ZONE 'Asia/Riyadh'
)
FROM (
  SELECT DISTINCT ON (ev."account_id", trim(ev."payload" -> 'data' -> 'order' ->> 'reference'))
    ev."account_id",
    trim(ev."payload" -> 'data' -> 'order' ->> 'reference') AS order_id,
    trim(ev."payload" -> 'data' -> 'order' ->> 'created_at') AS created_at
  FROM "store_connector_events" ev
  WHERE ev."account_id" IS NOT NULL
    AND ev."type" LIKE 'order.%'
    AND trim(ev."payload" -> 'data' -> 'order' ->> 'created_at')
      ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(\s?\+03:?00)?$'
  ORDER BY ev."account_id", trim(ev."payload" -> 'data' -> 'order' ->> 'reference'), ev."received_at" DESC
) e
WHERE o."account_id" = e."account_id"
  AND o."order_id" = e.order_id
  AND o."connector_updated_at" IS NOT NULL
  AND o."ordered_at" IS NULL;
