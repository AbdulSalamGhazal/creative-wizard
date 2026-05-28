CREATE TABLE "summary_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page" varchar(32) DEFAULT 'summary' NOT NULL,
	"name" varchar(120) NOT NULL,
	"query" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "summary_views" ADD CONSTRAINT "summary_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "summary_views_page_idx" ON "summary_views" USING btree ("page");--> statement-breakpoint
CREATE INDEX "summary_views_owner_idx" ON "summary_views" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_views_owner_name_idx" ON "summary_views" USING btree ("owner_user_id","page","name");