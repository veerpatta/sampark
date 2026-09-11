ALTER TABLE "request_batches" ADD COLUMN "reason_en" text;--> statement-breakpoint
ALTER TABLE "request_batches" ADD COLUMN "reason_hi" text;--> statement-breakpoint
ALTER TABLE "request_students" ADD COLUMN "ask_note" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "reason_en" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "reason_hi" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "phone_on_whatsapp" text;