CREATE TABLE "student_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	CONSTRAINT "student_documents_pathname_unique" UNIQUE("pathname")
);
--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_documents_student_idx" ON "student_documents" USING btree ("student_id","removed_at");