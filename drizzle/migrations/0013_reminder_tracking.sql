ALTER TABLE "requests" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "reminded_by" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_reminded_by_users_id_fk" FOREIGN KEY ("reminded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;