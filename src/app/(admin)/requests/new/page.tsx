import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listClassLabels } from "@/lib/students";
import { TEMPLATES } from "@/lib/templates";
import { RequestBuilder } from "./RequestBuilder";

export const metadata = { title: "New request — Sampark" };
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const [classes, teachers, fields] = await Promise.all([
    listClassLabels(),
    db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.active, true))
      .orderBy(asc(schema.teachers.name)),
    db
      .select()
      .from(schema.fieldDefs)
      .where(eq(schema.fieldDefs.active, true))
      .orderBy(asc(schema.fieldDefs.sortOrder)),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">New request</h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
      </header>

      <RequestBuilder
        classes={classes}
        teachers={teachers.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          classes: teacher.classes,
        }))}
        fields={fields.map((field) => ({
          key: field.key,
          labelEn: field.labelEn,
          labelHi: field.labelHi,
          mode: field.mode,
          needsPeriod: field.targetColumn === null,
        }))}
        templates={TEMPLATES}
        defaultPeriod={`${process.env.ACADEMIC_YEAR ?? "2026-27"}/FA1`}
      />
    </div>
  );
}
