import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/students-import";
import {
  readStudentColumn,
  STUDENT_COLUMN_BY_DB_NAME,
} from "@/lib/student-columns";
import { editFields, registryOptions } from "@/lib/student-edit";
import { titleCaseName } from "@/lib/classes";
import { decisionChip } from "@/components/ui/controls";
import { HouseChip } from "@/components/HouseChip";
import { Avatar } from "@/components/admin/Avatar";
import { Card } from "@/components/admin/Card";
import { PhotoEditor } from "@/components/admin/PhotoEditor";
import { StudentEditForm } from "@/components/admin/StudentEditForm";
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
 * EDITABLE, FOR THE PEOPLE WHO COULD ALREADY APPROVE THE SAME CHANGE.
 *
 * This page was read-only for a long time, on the stated grounds that a change
 * typed here "would carry no proposal, no reviewer and no audit trail". Two of
 * those three are now supplied and the third does not apply: the form is gated
 * on canApproveIntoMaster, so the person typing is the person who would have
 * approved the identical correction in /review; every field written appends a
 * change_log row, which is the card at the bottom of this page; and a proposal
 * exists to keep an unreviewed TEACHER out of master, which is not what is
 * happening here.
 *
 * What actually makes it safe is the provenance stamp. An edit claims its field
 * for `office`, which lib/precedence.ts treats as human and therefore permanent
 * against every import — so correcting a number here cannot be quietly undone
 * by the next PSP file. See lib/student-edit.ts.
 *
 * The `office` ROLE, confusingly, cannot do this: it can create requests and
 * read everything, but approving into master is owner and admin only.
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
  const [session, [student], history, records, waiting, options] = await Promise.all([
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
        recordKind: schema.fieldDefs.recordKind,
        // A one-off question files its answers under the ask that raised it, so
        // the period reads as "ask/<uuid>". Nobody should have to look at that;
        // the request already knows what it was called.
        requestTitle: schema.requests.title,
        requestId: schema.requests.id,
        /**
         * Who entered it.
         *
         * A mark is written the moment the teacher submits and leaves no
         * change_log row — there is no deciding user to put in one, and
         * inventing a system user would make the audit log assert that nobody
         * decided something rather than that a named person entered it. So this
         * is the screen that answers "who put this number here", and it is the
         * screen someone actually opens to ask. See lib/submissions.ts.
         */
        teacherName: schema.teachers.name,
      })
      .from(schema.studentRecords)
      .innerJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.studentRecords.fieldKey),
      )
      .leftJoin(
        schema.requests,
        eq(schema.requests.id, schema.studentRecords.requestId),
      )
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(eq(schema.studentRecords.studentId, studentId))
      .orderBy(desc(schema.studentRecords.period), asc(schema.studentRecords.fieldKey)),
    /*
     * Corrections a teacher has proposed for this child that nobody has decided
     * yet.
     *
     * Worth surfacing beside the boxes, because approving one LATER overwrites
     * whatever the office types now: decideSubmissions writes master
     * unconditionally and stamps `teacher`, which outranks `office`. So this is
     * not "something is waiting", it is "this field is about to be argued over".
     *
     * A direct query rather than listPendingReview(), which is scoped by request
     * and assembles far more than a warning line needs. Covered by
     * submissions_student_field_idx.
     */
    db
      .select({
        targetColumn: schema.fieldDefs.targetColumn,
        label: schema.fieldDefs.labelEn,
        teacherName: schema.teachers.name,
      })
      .from(schema.submissions)
      .innerJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.submissions.fieldKey),
      )
      .leftJoin(schema.requests, eq(schema.requests.id, schema.submissions.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(
        and(
          eq(schema.submissions.studentId, studentId),
          eq(schema.submissions.reviewStatus, "pending"),
        ),
      ),
    // The closed sets for gender and category. A read, not a constant, because
    // /settings/fields owns them — see registryOptions.
    registryOptions(),
  ]);

  if (!session) redirect("/login");
  if (!student) notFound();

  // Editing master data takes the same role as approving a correction into it.
  // The `office` role reads this page and gets no form.
  const canEdit = canApproveIntoMaster(session.role);
  const fields = canEdit ? editFields(student as Student, options) : [];

  // Keyed by students column, because that is what the form's inputs are named.
  // A field with no target_column collects into student_records and is not on
  // this form at all, so it is dropped here rather than warned about.
  const pendingByColumn = new Map<string, string>();
  for (const row of waiting) {
    // target_column is a DATABASE name; the form's inputs are named by Drizzle
    // property. STUDENT_COLUMN_BY_DB_NAME is the one sanctioned mapping — see
    // the warning at the top of student-columns.ts about the half of the
    // registry where the two strings differ.
    const property = row.targetColumn
      ? STUDENT_COLUMN_BY_DB_NAME.get(row.targetColumn)
      : undefined;
    if (!property) continue;
    pendingByColumn.set(
      property,
      `${row.teacherName ?? "A teacher"} has proposed a change to ${row.label}.`,
    );
  }

  return (
    <div className="space-y-5 md:space-y-8">
      <header className="flex items-start gap-3.5">
        {/* The face, next to the name. This is the screen you open when a
            parent rings, and a photograph is the fastest recognition aid there
            is. Deliberately NOT in the IMPORT_COLUMNS list below — a blob
            pathname printed as text would be noise. Initials when there is no
            photograph: two thirds of these children have none, and a column of
            grey circles gives the eye nothing to land on. */}
        <div>
          <Avatar
            pathname={student.photoPath}
            name={titleCaseName(student.name)}
            size="page"
          />
          {canEdit ? (
            <PhotoEditor
              studentId={student.id}
              hasPhoto={Boolean(student.photoPath)}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-[1.625rem] font-semibold leading-8 tracking-[-0.02em]">
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
        </div>
      </header>

      <div className="grid gap-5 md:gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card title="What we hold">
          <dl className="space-y-2 text-sm">
            {IMPORT_COLUMNS.map((spec) => {
              const value = holdValue(student as Student, spec.column);
              return (
                <div key={spec.column} className="grid grid-cols-[8rem_1fr] gap-3">
                  <dt className="text-[var(--color-ink-muted)]">{spec.label}</dt>
                  <dd className={value === null ? "text-[var(--color-warning)]" : "font-medium"}>
                    {value ?? "missing"}
                  </dd>
                </div>
              );
            })}
          </dl>
          {canEdit ? (
            /* CLOSED, this card reads exactly as it always did. Open, it is the
               editor — the same idiom as Settings → Teachers, and for the same
               reason: the page stays scannable, and editing is a deliberate tap
               rather than a text box under every value on a screen people open
               mainly to read. */
            <details className="mt-5 border-t border-[var(--color-border)] pt-4">
              <summary className="min-h-[var(--tap-min)] cursor-pointer list-none text-sm font-medium text-[var(--color-brand-600)]">
                Edit these details ▾
              </summary>
              <div className="mt-4">
                <StudentEditForm
                  studentId={student.id}
                  fields={fields}
                  pending={pendingByColumn}
                />
              </div>
            </details>
          ) : (
            <p className="mt-5 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-ink-muted)]">
              Read-only for your role. Correcting master data takes the same
              permission as approving a teacher&rsquo;s correction into it.
            </p>
          )}
        </Card>

        <div className="space-y-5 md:space-y-8">
          {records.length > 0 ? (
            <Card title="Marks and answers" flush>
              <table className="w-full text-sm">
                <tbody>
                  {records.map((row) => (
                    <tr
                      key={row.record.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-2 text-xs text-[var(--color-ink-muted)]">
                        {row.recordKind === "adhoc" ? (
                          row.requestId ? (
                            <Link
                              href={`/requests/${row.requestId}`}
                              className="hover:underline"
                            >
                              asked in {row.requestTitle}
                            </Link>
                          ) : (
                            "one-off question"
                          )
                        ) : (
                          <span className="font-mono">{row.record.period}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {row.fieldLabel}
                        {row.teacherName ? (
                          <span className="block text-xs text-[var(--color-ink-muted)]">
                            entered by {row.teacherName}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {row.record.value ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <Card title="Change history" flush>
            {history.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-ink-muted)]">
                Nothing has been decided or edited for this student. Values
                loaded by import do not appear here — the change log records
                what a named person decided or typed, and an import is neither.
              </p>
            ) : (
              /* A list, not a table. Five columns — when, who, field, the
                 diff, the decision — is 700px of content on a 360px screen,
                 and the diff is the column that was being pushed off the
                 right edge. Every entry is one decision, so it reads down. */
              <ul>
                {history.map((row) => (
                  <li
                    key={row.entry.id}
                    className="border-b border-[var(--color-border)] px-4 py-3 last:border-0"
                  >
                    <div className="font-mono text-xs text-[var(--color-ink-muted)]">
                      {formatWhen(row.entry.decidedAt)} · {row.decidedByName}
                    </div>
                    <div className="mt-1 text-sm">
                      {row.fieldLabel ?? row.entry.fieldKey}
                    </div>
                    <div className="mt-0.5 font-mono text-xs">
                      <span className="line-through opacity-60">
                        {row.entry.fromValue ?? "empty"}
                      </span>
                      <span className="mx-2" aria-hidden>
                        →
                      </span>
                      <span className="font-medium">
                        {row.entry.toValue ?? "empty"}
                      </span>
                    </div>
                    <span
                      className={`mt-1.5 inline-block ${decisionChip(row.entry.decision)}`}
                    >
                      {row.entry.decision}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
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

/**
 * One row of "What we hold".
 *
 * `id` GOES ROUND readStudentColumn, and it has to. That helper refuses the
 * columns in student-columns.ts's PROTECTED set — id, created_at, updated_at,
 * source — because a field_def must never be able to point at them and rewrite
 * a child's primary key. That is a rule about WRITING. Reading it back for a
 * card is a different question, and running the two through one helper meant
 * every student's page read "Student ID: missing", in the warning colour, next
 * to a header displaying that exact id.
 */
function holdValue(student: Student, column: string): string | null {
  if (column === "id") return student.id;
  return readStudentColumn(student, dbNameFor(column));
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}
