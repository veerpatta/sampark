CREATE TABLE "request_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"audience" jsonb NOT NULL,
	"field_keys" text[] NOT NULL,
	"period" text,
	"due_date" date NOT NULL,
	"recipient_mode" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "class_label" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "audience_kind" text DEFAULT 'class' NOT NULL;--> statement-breakpoint
--> HAND-EDITED. drizzle-kit generated a bare `ADD COLUMN ... NOT NULL`, which
--> cannot succeed on a table that already has rows: every existing request would
--> need a value the statement does not supply. Split into add, backfill, then
--> constrain. Every request written before this migration was scoped to a class,
--> so its class label IS its audience label.
ALTER TABLE "requests" ADD COLUMN "audience_label" text;--> statement-breakpoint
UPDATE "requests" SET "audience_label" = "class_label" WHERE "audience_label" IS NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "audience_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sent_by" text;--> statement-breakpoint
ALTER TABLE "request_batches" ADD CONSTRAINT "request_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_batch_id_request_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."request_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_batch_idx" ON "requests" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_batch_scope_idx" ON "requests" USING btree ("batch_id","audience_kind","audience_label") WHERE "requests"."batch_id" is not null;