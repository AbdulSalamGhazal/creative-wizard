DROP INDEX "creatives_status_idx";--> statement-breakpoint
CREATE INDEX "campaigns_account_objective_idx" ON "campaigns" USING btree ("account_id","objective");--> statement-breakpoint
CREATE INDEX "creatives_account_priority_idx" ON "creatives" USING btree ("account_id","priority");--> statement-breakpoint
CREATE INDEX "creatives_account_launch_date_idx" ON "creatives" USING btree ("account_id","launch_date");