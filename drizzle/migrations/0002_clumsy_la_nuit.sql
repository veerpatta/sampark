CREATE TABLE "field_sources" (
	"field_key" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_sources" (
	"student_id" text NOT NULL,
	"field_key" text NOT NULL,
	"source_key" text NOT NULL,
	"source_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_sources_student_id_field_key_pk" PRIMARY KEY("student_id","field_key")
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "house" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "aadhaar_last4" text;--> statement-breakpoint
ALTER TABLE "field_sources" ADD CONSTRAINT "field_sources_source_key_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."sources"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_sources" ADD CONSTRAINT "value_sources_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_sources" ADD CONSTRAINT "value_sources_source_key_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."sources"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "value_sources_source_idx" ON "value_sources" USING btree ("source_key");