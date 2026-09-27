CREATE TABLE "user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"digest_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_prefs" ADD CONSTRAINT "user_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;