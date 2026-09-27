CREATE TABLE "gardener_proposals" (
	"vault_id" text NOT NULL,
	"key" text NOT NULL,
	"changeset_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gardener_proposals_vault_id_key_pk" PRIMARY KEY("vault_id","key")
);
--> statement-breakpoint
CREATE TABLE "gardener_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"namespace" text,
	"requested_by" text,
	"state" text DEFAULT 'running' NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposals" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gardener_proposals" ADD CONSTRAINT "gardener_proposals_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gardener_runs" ADD CONSTRAINT "gardener_runs_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gardener_runs" ADD CONSTRAINT "gardener_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gardener_runs_vault" ON "gardener_runs" USING btree ("vault_id","started_at");