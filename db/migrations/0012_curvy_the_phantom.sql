CREATE TABLE "platform_rating_rules" (
	"platform" varchar(16) PRIMARY KEY NOT NULL,
	"min_spend" numeric(14, 2) DEFAULT '500' NOT NULL,
	"good_roas" numeric(10, 2) DEFAULT '4' NOT NULL,
	"decent_roas" numeric(10, 2) DEFAULT '2' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "platform_rating_rules" ADD CONSTRAINT "platform_rating_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;