CREATE TABLE "notification_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"category" varchar(16) NOT NULL,
	"type" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"actor_user_id" uuid,
	"entity_type" varchar(32),
	"entity_id" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_routes" ADD CONSTRAINT "notification_routes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_routes" ADD CONSTRAINT "notification_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_routes_account_event_user_idx" ON "notification_routes" USING btree ("account_id","event_type","user_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_account_created_idx" ON "notifications" USING btree ("recipient_user_id","account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("recipient_user_id","account_id") WHERE "notifications"."read_at" is null and "notifications"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_account_dedupe_idx" ON "notifications" USING btree ("account_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;