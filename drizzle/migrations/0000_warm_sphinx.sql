CREATE TABLE "change_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"field_key" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"decision" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "field_defs" (
	"key" text PRIMARY KEY NOT NULL,
	"label_en" text NOT NULL,
	"label_hi" text NOT NULL,
	"mode" text NOT NULL,
	"input_type" text NOT NULL,
	"target_column" text,
	"record_kind" text,
	"max_value" numeric,
	"exact_len" integer,
	"pattern" text,
	"options" jsonb,
	"sort_order" integer DEFAULT 100,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_students" (
	"request_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"roll_no" integer,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "request_students_request_id_student_id_pk" PRIMARY KEY("request_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"title" text NOT NULL,
	"class_label" text NOT NULL,
	"teacher_id" text NOT NULL,
	"field_keys" text[] NOT NULL,
	"period" text,
	"due_date" date NOT NULL,
	"pin" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "requests_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "student_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"field_key" text NOT NULL,
	"period" text NOT NULL,
	"value" text,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"sr_no" text,
	"admission_no" text,
	"class_label" text NOT NULL,
	"section" text,
	"roll_no" integer,
	"name" text NOT NULL,
	"father_name" text,
	"mother_name" text,
	"phone" text,
	"alt_phone" text,
	"dob" date,
	"gender" text,
	"category" text,
	"aadhaar" text,
	"jan_aadhaar" text,
	"village" text,
	"address" text,
	"bus_route" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'psp',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"field_key" text NOT NULL,
	"action" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_hash" text
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"classes" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'office' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_students" ADD CONSTRAINT "request_students_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_students" ADD CONSTRAINT "request_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_field_key_field_defs_key_fk" FOREIGN KEY ("field_key") REFERENCES "public"."field_defs"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_field_key_field_defs_key_fk" FOREIGN KEY ("field_key") REFERENCES "public"."field_defs"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_token_idx" ON "requests" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "student_records_unique" ON "student_records" USING btree ("student_id","field_key","period");--> statement-breakpoint
CREATE INDEX "students_class_roll_idx" ON "students" USING btree ("class_label","roll_no");--> statement-breakpoint
CREATE INDEX "students_sr_no_idx" ON "students" USING btree ("sr_no");--> statement-breakpoint
CREATE INDEX "students_status_idx" ON "students" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submissions_request_review_idx" ON "submissions" USING btree ("request_id","review_status");--> statement-breakpoint
CREATE INDEX "submissions_student_field_idx" ON "submissions" USING btree ("student_id","field_key");