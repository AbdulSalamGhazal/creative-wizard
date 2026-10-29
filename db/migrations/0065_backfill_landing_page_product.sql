-- 2026-10-29 landing-page product backfill (DATA-ONLY, hand-written — never
-- regenerate; `drizzle-kit generate` has nothing to say about data).
--
-- Every landing page now sells ONE product (`landing_pages.product_id`,
-- migration 0064), required by the registry on every save and enforced on
-- uploads (E024: a creative of another product may not be sent there). Pages
-- registered before this date have no product; this gives each one the
-- product its records already point to — when every record under the page
-- belongs to ONE product. A page with no records, or with records of several
-- products, is left NULL: the registry marks it "Needs a product" and the
-- next edit must pick one. Idempotent (only NULL rows are touched).
UPDATE "landing_pages" AS lp
SET "product_id" = d."product_id", "updated_at" = now()
FROM (
  SELECT pr."landing_page_id", MIN(c."product_id"::text)::uuid AS "product_id"
  FROM "performance_records" pr
  JOIN "creatives" c ON c."id" = pr."creative_id"
  WHERE pr."landing_page_id" IS NOT NULL
  GROUP BY pr."landing_page_id"
  HAVING COUNT(DISTINCT c."product_id") = 1
) AS d
WHERE lp."id" = d."landing_page_id" AND lp."product_id" IS NULL;
