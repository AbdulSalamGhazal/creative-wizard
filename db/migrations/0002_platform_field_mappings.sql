CREATE TABLE "platform_field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(16) NOT NULL,
	"internal_field" varchar(32) NOT NULL,
	"header_name" varchar(255) NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_field_mappings" ADD CONSTRAINT "platform_field_mappings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pfm_unique_idx" ON "platform_field_mappings" USING btree ("platform","internal_field","header_name");--> statement-breakpoint
CREATE INDEX "pfm_platform_idx" ON "platform_field_mappings" USING btree ("platform");