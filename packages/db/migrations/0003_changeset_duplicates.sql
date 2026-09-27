ALTER TABLE "changesets" ADD COLUMN "duplicates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "changesets" ADD COLUMN "ingest_item_id" text;