import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/students-import";
import { readStudentColumn } from "@/lib/student-columns";
import { titleCaseName } from "@/lib/classes";
import { HouseChip } from "@/components/HouseChip";
import type { Student } from "../../../../../drizzle/schema";

export const metadata = { title: "Student — Sampark" };
export const dynamic = "force-dynamic";

/**
 * One student, and everything that has ever been changed about them.
 *
 * Plan section 6. This is the screen you open when a parent rings to say a
 * number is wrong: it answers "what do we hold, who last changed it, and when"
 * without anyone opening the database.
 *
 * Read-only on purpose. Master data moves through the review queue or through
 * an import — never through a free-text box on a detail page, because a change
 * made here would carry no proposal, no reviewer and no audit trail.
 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const studentId = decodeURIComponent(id);

  // Every one of these needs only the id from the URL. The history and the
  // records do not wait on the student row existing — if it does not, the
  // notFound() below throws the whole page away and their answers with it.
  const [session, [student], history, records] = await Promise.all([
    currentUser(),
    db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, studentId))
      .limit(1),
    db
      .select({
        entry: schema.changeLog,
        decidedByName: schema.users.name,
        fieldLabel: schema.fieldDefs.labelEn,
      })
      .from(schema.changeLog)
      .innerJoin(schema.users, eq(schema.users.id, schema.changeLog.decidedBy))
      .leftJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.changeLog.fieldKey),
      )
      .where(eq(schema.changeLog.studentId, studentId))
      .orderBy(desc(schema.changeLog.decidedAt)),
    db
      .select({
        record: schema.studentRecords,
        fieldLabel: schema.fieldDefs.labelEn,
      })
      .from(schema.studentRecords)
      .innerJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.studentRecords.fieldKey),
      )
      .where(eq(schema.studentRecords.studentId, studentId))
      .orderBy(desc(schema.studentRecords.period), asc(schema.studentRecords.fieldKey)),
  ]);

  if (!session) redirect("/login");
  if (!student) notFound();

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            {titleCaseName(student.name)}
          </h1>
          <Link
            href={`/students?class=${encodeURIComponent(student.classLabel)}`}
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            {student.classLabel}
          </Link>
          {/* The house was collected in prompt 4 and then never shown here,
              which is the screen you open when a parent rings. */}
          <HouseChip house={student.house} lang="en" />
          {student.id.startsWith("TMP-") ? (
            <span className="rounded bg-[var(--color-correct-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-correct-fg)]">
              temporary ID — replace with the real PSP one
            </span>
          ) : null}
          {student.status !== "active" ? (
            <span className="rounded bg-[var(--color-absent-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-absent-fg)]">
              {student.status}
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-xs text-[var(--color-ink-muted)]">
          {student.id}
          {student.srNo ? ` · SR ${student.srNo}` : ""}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            What we hold
          </h2>
          <dl className="mt-4 space-y-2 text-sm">
            {IMPORT_COLUMNS.map((spec) => {
              const value = readStudentColumn(
                student as Student,
                dbNameFor(spec.column),
              );
              return (
                <div key={spec.column} className="grid grid-cols-[9rem_1fr] gap-3">
                  <dt className="text-[var(--color-ink-muted)]">{spec.label}</dt>
                  <dd className={value === null ? "text-[var(--color-warning)]" : "font-medium"}>
                    {value ?? "missing"}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-5 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-ink-muted)]">
            Read-only. Master data moves through the review queue or an import —
            a change typed here would carry no proposal, no reviewer and no
            audit trail.
          </p>
        </section>

        <div className="space-y-8">
          {records.length > 0 ? (
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
              <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Period records
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {records.map((row) => (
                    <tr
                      key={row.record.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {row.record.period}
                      </td>
                      <td className="px-4 py-2">{row.fieldLabel}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {row.record.value ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
            <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Change history
            </h2>
            {history.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-ink-muted)]">
                Nothing has been approved or rejected for this student. Values
                loaded by import do not appear here — the change log records
                decisions, and an import is not one.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {history.map((row) => (
                    <tr
                      key={row.entry.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-[var(--color-ink-muted)]">
                        {formatWhen(row.entry.decidedAt)}
                      </td>
                      <td className="px-4 py-2">
                        {row.fieldLabel ?? row.entry.fieldKey}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        <span className="line-through opacity-60">
                          {row.entry.fromValue ?? "empty"}
                        </span>
                        <span className="mx-2" aria-hidden>
                          →
                        </span>
                        <span className="font-medium">
                          {row.entry.toValue ?? "empty"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            row.entry.decision === "approved"
                              ? "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]"
                              : "bg-[var(--color-absent-bg)] text-[var(--color-absent-fg)]"
                          }`}
                        >
                          {row.entry.decision}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-[var(--color-ink-muted)]">
                        {row.decidedByName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * IMPORT_COLUMNS is keyed by Drizzle property name; readStudentColumn wants the
 * database name. camelCase to snake_case is the whole mapping.
 */
function dbNameFor(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}
