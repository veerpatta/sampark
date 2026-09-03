CREATE TABLE "completeness_snapshots" (
	"day" date NOT NULL,
	"class_label" text NOT NULL,
	"field" text NOT NULL,
	"filled" integer NOT NULL,
	"total" integer NOT NULL,
	CONSTRAINT "completeness_snapshots_day_class_label_field_pk" PRIMARY KEY("day","class_label","field")
);
