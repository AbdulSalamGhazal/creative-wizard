ALTER TABLE "exclusion_rules" DROP CONSTRAINT "exclusion_rules_one_target_check";--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD COLUMN "parent_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_parent_campaign_id_parent_campaigns_id_fk" FOREIGN KEY ("parent_campaign_id") REFERENCES "public"."parent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exclusion_rules_account_parent_campaign_idx" ON "exclusion_rules" USING btree ("account_id","parent_campaign_id") WHERE "exclusion_rules"."kind" = 'parent_campaign';--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_one_target_check" CHECK ((
        ("exclusion_rules"."kind" = 'campaign_objective' AND "exclusion_rules"."objective" IS NOT NULL AND "exclusion_rules"."campaign_id" IS NULL AND "exclusion_rules"."creative_id" IS NULL AND "exclusion_rules"."parent_campaign_id" IS NULL) OR
        ("exclusion_rules"."kind" = 'campaign' AND "exclusion_rules"."campaign_id" IS NOT NULL AND "exclusion_rules"."objective" IS NULL AND "exclusion_rules"."creative_id" IS NULL AND "exclusion_rules"."parent_campaign_id" IS NULL) OR
        ("exclusion_rules"."kind" = 'creative' AND "exclusion_rules"."creative_id" IS NOT NULL AND "exclusion_rules"."objective" IS NULL AND "exclusion_rules"."campaign_id" IS NULL AND "exclusion_rules"."parent_campaign_id" IS NULL) OR
        ("exclusion_rules"."kind" = 'parent_campaign' AND "exclusion_rules"."parent_campaign_id" IS NOT NULL AND "exclusion_rules"."objective" IS NULL AND "exclusion_rules"."campaign_id" IS NULL AND "exclusion_rules"."creative_id" IS NULL)
      ));