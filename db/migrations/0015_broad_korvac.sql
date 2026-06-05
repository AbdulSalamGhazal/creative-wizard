CREATE TABLE "creative_platform_overrides" (
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"creative_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"terminated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminated_by_user_id" uuid,
	CONSTRAINT "creative_platform_overrides_creative_id_platform_pk" PRIMARY KEY("creative_id","platform")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "status_window_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "creative_platform_overrides" ADD CONSTRAINT "creative_platform_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_platform_overrides" ADD CONSTRAINT "creative_platform_overrides_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_platform_overrides" ADD CONSTRAINT "creative_platform_overrides_terminated_by_user_id_users_id_fk" FOREIGN KEY ("terminated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cpo_account_idx" ON "creative_platform_overrides" USING btree ("account_id");--> statement-breakpoint
-- Preserve intent of the old manual status: every creative that was 'archived'
-- becomes Terminated on each platform it ran on (the new dynamic model has no
-- 'archived' state). Everything else recomputes from spend. The legacy
-- creatives.status column is left in place but is no longer read.
INSERT INTO "creative_platform_overrides" ("account_id", "creative_id", "platform", "terminated_at")
SELECT DISTINCT c."account_id", c."id", pr."platform", now()
FROM "creatives" c
JOIN "performance_records" pr ON pr."creative_id" = c."id"
WHERE c."status" = 'archived'
ON CONFLICT ("creative_id", "platform") DO NOTHING;