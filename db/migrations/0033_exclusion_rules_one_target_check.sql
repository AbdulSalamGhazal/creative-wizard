-- Exactly-one-target CHECK for exclusion_rules (DB backstop for
-- validateRuleTarget). Added NOT VALID then VALIDATEd so a table that already
-- has rows takes no long ACCESS EXCLUSIVE validation lock; VALIDATE scans
-- without blocking writes. Existing rows all satisfy it (written by the code
-- path that validates), so VALIDATE succeeds.
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_one_target_check" CHECK ((
        ("exclusion_rules"."kind" = 'campaign_objective' AND "exclusion_rules"."objective" IS NOT NULL AND "exclusion_rules"."campaign_id" IS NULL AND "exclusion_rules"."creative_id" IS NULL) OR
        ("exclusion_rules"."kind" = 'campaign' AND "exclusion_rules"."campaign_id" IS NOT NULL AND "exclusion_rules"."objective" IS NULL AND "exclusion_rules"."creative_id" IS NULL) OR
        ("exclusion_rules"."kind" = 'creative' AND "exclusion_rules"."creative_id" IS NOT NULL AND "exclusion_rules"."objective" IS NULL AND "exclusion_rules"."campaign_id" IS NULL)
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "exclusion_rules" VALIDATE CONSTRAINT "exclusion_rules_one_target_check";
