CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"campaign_name" text NOT NULL,
	"language" text NOT NULL,
	"teacher_id" text,
	"phone" text NOT NULL,
	"request_ids" text[] DEFAULT '{}' NOT NULL,
	"batch_id" uuid,
	"template_params" jsonb NOT NULL,
	"button_suffix" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"provider_response" jsonb,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "language" text DEFAULT 'hi' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_batch_id_request_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."request_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_batch_idx" ON "whatsapp_messages" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_teacher_idx" ON "whatsapp_messages" USING btree ("teacher_id","created_at");