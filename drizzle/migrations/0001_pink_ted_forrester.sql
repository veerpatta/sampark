CREATE TABLE "rate_limits" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_idempotency_idx" ON "submissions" USING btree ("idempotency_key","student_id","field_key");--> statement-breakpoint
ALTER TABLE "requests" DROP COLUMN "pin";