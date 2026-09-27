CREATE TABLE "assets" (
	"vault_id" text NOT NULL,
	"path" text NOT NULL,
	"namespace" text,
	"blob_sha" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "assets_vault_id_path_pk" PRIMARY KEY("vault_id","path")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"vault_id" text NOT NULL,
	"sha" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"change_class" text,
	CONSTRAINT "commits_vault_id_sha_pk" PRIMARY KEY("vault_id","sha")
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_model_content_hash_pk" PRIMARY KEY("model","content_hash")
);
--> statement-breakpoint
CREATE TABLE "namespace_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"namespace" text NOT NULL,
	"team_id" text,
	"user_id" text,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"vault_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'company' NOT NULL,
	"publishing" text DEFAULT 'manual' NOT NULL,
	"ai_processing" boolean DEFAULT true NOT NULL,
	"owner_team" text,
	CONSTRAINT "namespaces_vault_id_slug_pk" PRIMARY KEY("vault_id","slug")
);
--> statement-breakpoint
CREATE TABLE "note_commits" (
	"vault_id" text NOT NULL,
	"note_id" text NOT NULL,
	"sha" text NOT NULL,
	"path" text NOT NULL,
	"status" text NOT NULL,
	"from_version" text,
	"to_version" text,
	"change_class" text,
	"committed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "note_commits_vault_id_note_id_sha_pk" PRIMARY KEY("vault_id","note_id","sha")
);
--> statement-breakpoint
CREATE TABLE "note_links" (
	"vault_id" text NOT NULL,
	"source_id" text NOT NULL,
	"href" text NOT NULL,
	"target_path" text NOT NULL,
	"target_id" text,
	"kind" text NOT NULL,
	"wanted" boolean DEFAULT false NOT NULL,
	"anchor" text,
	"label" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"vault_id" text NOT NULL,
	"id" text NOT NULL,
	"path" text NOT NULL,
	"slug" text NOT NULL,
	"namespace" text,
	"folder" text DEFAULT '' NOT NULL,
	"hub_kind" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"themes" text[] DEFAULT '{}'::text[] NOT NULL,
	"systems" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body" text NOT NULL,
	"version" text,
	"status" text DEFAULT 'stable' NOT NULL,
	"trust_tier" text NOT NULL,
	"stale_after" timestamp with time zone,
	"owner" text,
	"superseded_by" text,
	"content_hash" text NOT NULL,
	"blob_sha" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"row_hash" text NOT NULL,
	"last_commit_sha" text,
	"last_changed_at" timestamp with time zone,
	"last_changed_by" text,
	"process_changed_at" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_vault_id_id_pk" PRIMARY KEY("vault_id","id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_terms" (
	"vault_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"facet" text,
	"state" text DEFAULT 'active' NOT NULL,
	"hub_note_id" text,
	CONSTRAINT "taxonomy_terms_vault_id_kind_slug_pk" PRIMARY KEY("vault_id","kind","slug")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"service_account" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"repository" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"bundle_root" text DEFAULT 'kb' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_indexed_head" text,
	"last_indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vaults_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "namespace_grants" ADD CONSTRAINT "namespace_grants_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_grants" ADD CONSTRAINT "namespace_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_grants" ADD CONSTRAINT "namespace_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_terms" ADD CONSTRAINT "taxonomy_terms_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "namespace_grants_vault_ns" ON "namespace_grants" USING btree ("vault_id","namespace");--> statement-breakpoint
CREATE INDEX "note_commits_time" ON "note_commits" USING btree ("vault_id","committed_at");--> statement-breakpoint
CREATE INDEX "note_links_source" ON "note_links" USING btree ("vault_id","source_id");--> statement-breakpoint
CREATE INDEX "note_links_target" ON "note_links" USING btree ("vault_id","target_id");--> statement-breakpoint
CREATE INDEX "note_links_target_path" ON "note_links" USING btree ("vault_id","target_path");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_vault_path" ON "notes" USING btree ("vault_id","path");--> statement-breakpoint
CREATE INDEX "notes_vault_ns" ON "notes" USING btree ("vault_id","namespace");--> statement-breakpoint
CREATE INDEX "notes_vault_type" ON "notes" USING btree ("vault_id","type");--> statement-breakpoint
CREATE INDEX "notes_themes" ON "notes" USING gin ("themes");--> statement-breakpoint
CREATE INDEX "notes_systems" ON "notes" USING gin ("systems");--> statement-breakpoint
CREATE INDEX "notes_tags" ON "notes" USING gin ("tags");