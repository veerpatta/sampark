import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { countByClass } from "@/lib/students";
import { CLASS_LABELS } from "@/lib/classes";
import { TEMPLATES } from "@/lib/templates";
import { RequestBuilder } from "./RequestBuilder";

export const metadata = { title: "New request — Sampark" };
export const dynamic = "force-dynamic";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; template?: string }>;
}) {
  // QuickSend hands over here when it will not guess — two teachers on the
  // class, no number saved, or a template that needs a period typed in. The
  // choices she already made come with her rather than being asked again.
  const handoff = await searchParams;
  const [counts, teachers, fields] = await Promise.all([
    countByClass(),
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
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">New request</h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
      </header>

      {/* The canonical nineteen, not whatever labels happen to be in the
          students table. A class with no students is shown but cannot be
          picked — that is a missing import to fix, not a class to invent. */}
      <RequestBuilder
        classes={CLASS_LABELS.map((label) => ({
          label,
          students: counts.get(label) ?? 0,
        }))}
        teachers={teachers.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          classes: teacher.classes,
          // Sent down so the number can be shown and edited beside her name.
          // The office should never have to leave this screen to find out
          // which number a link is about to go to.
          phone: teacher.phone,
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
        initialClass={handoff.class ?? ""}
        initialTemplate={handoff.template ?? ""}
      />
    </div>
  );
}
