CREATE TABLE "store_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_key" varchar(48) NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_pull_at" timestamp with time zone,
	"last_pull_error" text,
	"pull_cursor" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_connector_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"account_id" uuid,
	"store_key" varchar(48) NOT NULL,
	"type" varchar(48) NOT NULL,
	"occurred_at" timestamp with time zone,
	"via" varchar(8) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_orders" ALTER COLUMN "upload_batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "connector_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_connector_events" ADD CONSTRAINT "store_connector_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_connections_account_idx" ON "store_connections" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_connections_store_key_idx" ON "store_connections" USING btree ("store_key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_connector_events_event_id_idx" ON "store_connector_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "store_connector_events_account_received_idx" ON "store_connector_events" USING btree ("account_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "store_connector_events_account_occurred_idx" ON "store_connector_events" USING btree ("account_id","occurred_at");