ALTER TABLE "creatives" ADD COLUMN "stages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "creatives_stages_idx" ON "creatives" USING gin ("stages");