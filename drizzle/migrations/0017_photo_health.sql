ALTER TABLE "students" ADD COLUMN "photo_broken_path" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "photo_broken_reason" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "photo_broken_at" timestamp with time zone;