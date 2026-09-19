-- Google platform, phase 1 (additive).
--
-- The ONE schema change: system creatives. Every google performance row hangs
-- off a single app-owned creative ("Google Ads"), which must not be renamed or
-- deleted — the upload pipeline resolves it by name.
ALTER TABLE "creatives" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;

-- NOTE: the google-unavailable metric columns on performance_records
-- (landing_page_views, add_to_cart, add_payment, video_views_*) were ALREADY
-- nullable (0010 / 0019 added them without NOT NULL), so there is nothing to
-- drop here. Adding "google" to the platform vocabulary needs no migration
-- either: platform is a varchar, not a Postgres enum.
