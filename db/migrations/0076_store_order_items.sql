CREATE TABLE "store_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"store_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"sku" varchar(128),
	"name" text,
	"quantity" integer NOT NULL,
	"line_total_sar" numeric(12, 2)
);
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_store_order_id_store_orders_id_fk" FOREIGN KEY ("store_order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_order_items_order_position_idx" ON "store_order_items" USING btree ("store_order_id","position");--> statement-breakpoint
CREATE INDEX "store_order_items_account_sku_idx" ON "store_order_items" USING btree ("account_id","sku");