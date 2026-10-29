ALTER TABLE "landing_pages" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "landing_pages_product_idx" ON "landing_pages" USING btree ("product_id");