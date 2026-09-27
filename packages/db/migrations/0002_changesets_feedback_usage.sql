CREATE TABLE "changesets" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"submitter_id" text,
	"actor" text NOT NULL,
	"source" text NOT NULL,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"change_class" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"reason" text,
	"summary" text,
	"verify" boolean DEFAULT false NOT NULL,
	"ops" jsonb NOT NULL,
	"intents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_shas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"final_ops" jsonb,
	"prepared_head" text,
	"namespaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"note_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_summary" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approver_level" text,
	"resolves_reports" text[] DEFAULT '{}'::text[] NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_sha" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"note_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"reason" text,
	"comment" text,
	"origin" text DEFAULT 'library' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_vault_id_target_pk" PRIMARY KEY("user_id","vault_id","target")
);
--> statement-breakpoint
CREATE TABLE "ingest_items" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"changeset_id" text,
	"submitter_id" text,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_key" text,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"file_hash" text,
	"duplicate_of" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"state_reason" text,
	"batch_id" text,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"user_id" text,
	"vault_id" text,
	"namespace" text,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"batch" boolean DEFAULT false NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_flags" (
	"vault_id" text NOT NULL,
	"note_id" text NOT NULL,
	"cause_note_id" text NOT NULL,
	"cause_sha" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_flags_vault_id_note_id_cause_note_id_cause_sha_pk" PRIMARY KEY("vault_id","note_id","cause_note_id","cause_sha")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"changeset_id" text NOT NULL,
	"reviewer_id" text,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_changeset_id_changesets_id_fk" FOREIGN KEY ("changeset_id") REFERENCES "public"."changesets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_changeset_id_changesets_id_fk" FOREIGN KEY ("changeset_id") REFERENCES "public"."changesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changesets_vault_state" ON "changesets" USING btree ("vault_id","state");--> statement-breakpoint
CREATE INDEX "changesets_submitter" ON "changesets" USING btree ("submitter_id","created_at");--> statement-breakpoint
CREATE INDEX "changesets_note_ids" ON "changesets" USING gin ("note_ids");--> statement-breakpoint
CREATE INDEX "feedback_note" ON "feedback" USING btree ("vault_id","note_id","state");--> statement-breakpoint
CREATE INDEX "feedback_user_day" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ingest_items_vault_state" ON "ingest_items" USING btree ("vault_id","state");--> statement-breakpoint
CREATE INDEX "ingest_items_hash" ON "ingest_items" USING btree ("vault_id","file_hash");--> statement-breakpoint
CREATE INDEX "llm_usage_at" ON "llm_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "llm_usage_user_day" ON "llm_usage" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "note_flags_open" ON "note_flags" USING btree ("vault_id","cleared_at");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "reviews_changeset" ON "reviews" USING btree ("changeset_id");