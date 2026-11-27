CREATE TABLE "ps_ad_product_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"product_id" uuid NOT NULL,
	"ps_product_id" varchar(200) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ps_sku_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"product_key" text NOT NULL,
	"ps_product_id" varchar(200) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ps_sku_offer_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"product_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"ps_offer_id" varchar(200) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ps_ad_product_mappings" ADD CONSTRAINT "ps_ad_product_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_ad_product_mappings" ADD CONSTRAINT "ps_ad_product_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_ad_product_mappings" ADD CONSTRAINT "ps_ad_product_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_sku_mappings" ADD CONSTRAINT "ps_sku_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_sku_mappings" ADD CONSTRAINT "ps_sku_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_sku_offer_mappings" ADD CONSTRAINT "ps_sku_offer_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_sku_offer_mappings" ADD CONSTRAINT "ps_sku_offer_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ps_ad_product_mappings_account_product_idx" ON "ps_ad_product_mappings" USING btree ("account_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_sku_mappings_account_key_idx" ON "ps_sku_mappings" USING btree ("account_id","product_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_sku_offer_mappings_account_key_qty_idx" ON "ps_sku_offer_mappings" USING btree ("account_id","product_key","quantity");