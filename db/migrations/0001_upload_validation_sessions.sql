CREATE TABLE "upload_validation_sessions" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(16) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_validation_sessions" ADD CONSTRAINT "upload_validation_sessions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uvs_expires_idx" ON "upload_validation_sessions" USING btree ("expires_at");