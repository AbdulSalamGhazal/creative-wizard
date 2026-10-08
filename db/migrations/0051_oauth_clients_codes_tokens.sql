-- OAuth 2.1 for the MCP server (additive) — three tables, nothing else touched.
-- `oauth_clients`: dynamically registered clients (claude.ai registers itself);
-- redirect URIs are stored as EXACT strings and matched exactly. `oauth_codes`:
-- single-use authorization codes, 10 minutes, bound to client + redirect_uri +
-- PKCE challenge + user; `consumed_at` is set by an atomic UPDATE so a replay
-- loses the race. `oauth_tokens`: access and refresh tokens sharing a
-- `family_id` lineage, so reusing a rotated refresh token can revoke the whole
-- family. Every secret is stored as a SHA-256 hash — raw values exist only in
-- the response that returns them. Personal `cwz_` keys (api_tokens) keep
-- working unchanged; this is dual auth, not a replacement.
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" varchar(120) NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"token_endpoint_auth_method" varchar(32) DEFAULT 'none' NOT NULL,
	"client_secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(8) NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_user_idx" ON "oauth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_expires_idx" ON "oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");