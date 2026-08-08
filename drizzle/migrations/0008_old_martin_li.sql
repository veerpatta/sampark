ALTER TABLE "teachers" ADD COLUMN "link_token" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "link_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_link_token_idx" ON "teachers" USING btree ("link_token");