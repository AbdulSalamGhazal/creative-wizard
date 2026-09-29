-- Toast scope (additive) — which arriving notifications interrupt you while
-- the app is open: 'personal' (the default), 'all' or 'off'. App-side enum
-- (lib/notifications.ts), so a later value needs no migration. NOT NULL with a
-- default, so every existing user lands on 'personal' without a backfill.
ALTER TABLE "users" ADD COLUMN "toast_scope" varchar(8) DEFAULT 'personal' NOT NULL;