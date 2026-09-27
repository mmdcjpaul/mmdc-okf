CREATE TABLE "llm_batch_requests" (
	"key" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text,
	"vault_id" text,
	"namespace" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"batch_id" text,
	"answer" text,
	"usage" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"state" text DEFAULT 'submitted' NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"error" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"polled_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note_questions" (
	"vault_id" text NOT NULL,
	"note_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"questions" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_questions_vault_id_note_id_pk" PRIMARY KEY("vault_id","note_id")
);
--> statement-breakpoint
ALTER TABLE "llm_batch_requests" ADD CONSTRAINT "llm_batch_requests_batch_id_llm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."llm_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_questions" ADD CONSTRAINT "note_questions_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_batch_requests_state" ON "llm_batch_requests" USING btree ("state","provider");--> statement-breakpoint
CREATE INDEX "llm_batch_requests_owner" ON "llm_batch_requests" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "llm_batch_requests_batch" ON "llm_batch_requests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "llm_batches_state" ON "llm_batches" USING btree ("state","submitted_at");