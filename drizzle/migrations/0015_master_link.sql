ALTER TABLE "requests" ADD COLUMN "token_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "is_office" boolean DEFAULT false NOT NULL;