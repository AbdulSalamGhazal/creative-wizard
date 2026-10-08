-- Comment reactions (additive) — one table, nothing else touched.
-- One row per (comment, user, kind): the unique index IS the toggle, so a
-- second click deletes the row it would have duplicated. `kind` is a short key
-- from the app-side vocabulary (COMMENT_REACTIONS in lib/comments.ts), which is
-- why a sixth reaction needs no migration. Reactions cascade with their comment
-- and with their user; `account_id` follows the house tenancy pattern.
CREATE TABLE "comment_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_comment_user_kind_idx" ON "comment_reactions" USING btree ("comment_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("comment_id");