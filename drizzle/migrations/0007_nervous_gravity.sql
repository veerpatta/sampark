CREATE TABLE "teacher_subjects" (
	"teacher_id" text NOT NULL,
	"subject_key" text NOT NULL,
	"class_label" text NOT NULL,
	"assigned_by" text DEFAULT 'office' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_subjects_teacher_id_subject_key_class_label_pk" PRIMARY KEY("teacher_id","subject_key","class_label")
);
--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teacher_subjects_lookup_idx" ON "teacher_subjects" USING btree ("subject_key","class_label");