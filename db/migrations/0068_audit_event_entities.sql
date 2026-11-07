CREATE TABLE "audit_event_entities" (
	"audit_event_id" bigint NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"entity_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event_entities" ADD CONSTRAINT "audit_event_entities_audit_event_id_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event_entities" ADD CONSTRAINT "audit_event_entities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_entities_uq" ON "audit_event_entities" USING btree ("audit_event_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_entities_entity_idx" ON "audit_event_entities" USING btree ("account_id","entity_type","entity_id","audit_event_id" DESC NULLS LAST);