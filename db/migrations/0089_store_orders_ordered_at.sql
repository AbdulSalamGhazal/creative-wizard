DROP INDEX "store_orders_account_date_idx";--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "ordered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "store_orders_account_date_idx" ON "store_orders" USING btree ("account_id","order_date","ordered_at");