import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { STUDENT_COLUMN_BY_DB_NAME } from "@/lib/student-columns";
import {
  EDIT_SECTIONS,
  dbNameFor,
  editFields,
  registryOptions,
  sectionFields,
  type EditField,
} from "@/lib/student-edit";
import {
  describeProvenance,
  describeSources,
  loadValueSources,
  mergeProvenance,
  type ProvenanceLine,
} from "@/lib/student-provenance";
import { loadTimelineParts, mergeTimeline } from "@/lib/student-timeline";
import { listSharingPhone } from "@/lib/students";
import { completeness, TRACKED_FIELDS, TRACKED_LABELS } from "@/lib/completeness";
import { pivotStudentMarks } from "@/lib/marks";
import { FA_MARKS_KIND } from "@/lib/subjects";
import { buildParentMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { titleCaseName } from "@/lib/classes";
import { btn, chip } from "@/components/ui/controls";
import { HouseChip } from "@/components/HouseChip";
import { Avatar } from "@/components/admin/Avatar";
import { Card } from "@/components/admin/Card";
import { DocumentsCard } from "@/components/admin/DocumentsCard";
import { PhotoEditor } from "@/components/admin/PhotoEditor";
import { PrintButton } from "@/components/admin/PrintButton";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { RememberStudent } from "@/components/admin/RememberStudent";
import { Sparkline } from "@/components/admin/Sparkline";
import { StudentEditForm } from "@/components/admin/StudentEditForm";
import { Timeline, formatDay } from "@/components/admin/Timeline";
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
 * FIVE SECTIONS DOWN ONE PAGE, NOT TABS. Overview, details, documents, marks,
 * timeline — anchored, so a link can point at "the marks" and a phone scrolls
 * rather than taps. Tabs would hide four fifths of the record behind chrome on
 * exactly the screen whose point is that everything is on it.
 *
 * EDITABLE, FOR THE PEOPLE WHO COULD ALREADY APPROVE THE SAME CHANGE.
 *
 * The form is gated on canApproveIntoMaster, so the person typing is the person
 * who would have approved the identical correction in /review; every field
 * written appends a change_log row, which is the timeline at the foot of this
 * page; and a proposal exists to keep an unreviewed TEACHER out of master,
 * which is not what is happening here. What actually makes it safe is the
 * provenance stamp — an edit claims its field for `office`, which
 * lib/precedence.ts treats as human and therefore permanent against every
 * import. See lib/student-edit.ts. The `office` ROLE, confusingly, cannot do
 * this: it reads everything and edits nothing.
 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const studentId = decodeURIComponent(id);

  // Every one of these needs only the id from the URL. If the student does not
  // exist, notFound() below throws the whole page away and their answers with it.
  const [session, [student], parts, waiting, options, siblings, valueSources] = await Promise.all([
    currentUser(),
    db.select().from(schema.students).where(eq(schema.students.id, studentId)).limit(1),
    loadTimelineParts(studentId),
    /*
     * Corrections a teacher has proposed for this child that nobody has decided
     * yet. Approving one LATER overwrites whatever the office types now, so this
     * is not "something is waiting", it is "this field is about to be argued
     * over". Covered by submissions_student_field_idx.
     */
    db
      .select({
        targetColumn: schema.fieldDefs.targetColumn,
        label: schema.fieldDefs.labelEn,
        teacherName: schema.teachers.name,
      })
      .from(schema.submissions)
      .innerJoin(schema.fieldDefs, eq(schema.fieldDefs.key, schema.submissions.fieldKey))
      .leftJoin(schema.requests, eq(schema.requests.id, schema.submissions.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(
        and(
          eq(schema.submissions.studentId, studentId),
          eq(schema.submissions.reviewStatus, "pending"),
        ),
      ),
    registryOptions(),
    // Both of these need only the id from the URL, so they ride the same wave
    // as everything else. This page used to run a second, dependent wave for
    // them — a whole extra round trip to Singapore for two queries that never
    // needed the student row.
    listSharingPhone(studentId),
    loadValueSources(studentId),
  ]);

  if (!session) redirect("/login");
  if (!student) notFound();

  // Pure: the value's source, merged with who last decided it.
  const provenance = mergeProvenance(valueSources, parts.log);

  const canEdit = canApproveIntoMaster(session.role);
  const fields = editFields(student as Student, options);
  const name = titleCaseName(student.name);

  const pendingByColumn = new Map<string, string>();
  for (const row of waiting) {
    const property = row.targetColumn ? STUDENT_COLUMN_BY_DB_NAME.get(row.targetColumn) : undefined;
    if (!property) continue;
    pendingByColumn.set(property, `${row.teacherName ?? "A teacher"} has proposed a change to ${row.label}.`);
  }

  /*
   * Where each value came from, keyed by Drizzle property — which is what the
   * form's inputs are named.
   *
   * SPLIT BY KIND, because saying "PSP import · 12 Mar" under all twenty boxes
   * is twenty lines of the same sentence: it doubled this page on a phone and
   * buried the one line that matters, which is that a teacher corrected this
   * number last week. A person's line sits against its field; the files are
   * named once at the foot of each card.
   */
  const lines = new Map<string, ProvenanceLine>();
  for (const field of fields) {
    lines.set(
      field.column,
      describeProvenance(provenance.get(dbNameFor(field.column)), field.value !== "", formatDay),
    );
  }
  const hints = new Map<string, string>();
  for (const [column, line] of lines) {
    if (line?.kind === "person") hints.set(column, line.text);
  }

  const score = completeness(student as Student);
  const missing = TRACKED_FIELDS.filter((key) => {
    const value = student[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
  const events = mergeTimeline(parts);
  const marks = pivotStudentMarks(
    parts.records
      .filter((row) => row.recordKind === FA_MARKS_KIND)
      .map((row) => ({
        fieldKey: row.fieldKey,
        fieldLabel: row.fieldLabel,
        sortOrder: row.sortOrder,
        period: row.period,
        value: row.value,
        maxValue: row.maxValue,
      })),
  );

  const sections = [
    ["overview", "Overview"],
    ["details", "Details"],
    ["documents", "Documents"],
    ["marks", "Marks"],
    ["timeline", "Timeline"],
  ] as const;

  return (
    <div className="space-y-5 md:space-y-8">
      <RememberStudent id={student.id} name={name} classLabel={student.classLabel} />

      <header className="flex items-start gap-3.5">
        <div>
          <Avatar pathname={student.photoPath} name={name} size="page" />
          {canEdit ? (
            <div className="no-print">
              <PhotoEditor studentId={student.id} hasPhoto={Boolean(student.photoPath)} />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-[1.625rem] font-semibold leading-8 tracking-[-0.02em]">{name}</h1>
            <Link
              href={`/students?class=${encodeURIComponent(student.classLabel)}`}
              className="text-sm text-[var(--color-brand-600)] hover:underline"
            >
              {student.classLabel}
              {student.section ? ` ${student.section}` : ""}
            </Link>
            {student.rollNo ? (
              <span className="text-sm text-[var(--color-ink-muted)]">Roll {student.rollNo}</span>
            ) : null}
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
            {student.fatherName ? ` · ${titleCaseName(student.fatherName)}` : ""}
          </p>

          {/* Real links, never popup-blocked. tel: dials; wa.me opens the
              family's chat with the school named — see buildParentMessage. */}
          <div className="no-print mt-3 flex flex-wrap gap-2">
            {student.phone ? (
              <>
                <a href={`tel:+91${student.phone}`} className={btn()}>
                  Call {student.phone}
                </a>
                <a
                  href={buildWhatsAppLink(
                    student.phone,
                    buildParentMessage({ name, classLabel: student.classLabel }),
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btn({ tone: "go" })}
                >
                  WhatsApp the family
                </a>
              </>
            ) : (
              <span className="inline-flex min-h-[var(--tap-min)] items-center text-sm text-[var(--color-warning-fg)]">
                No mobile number on record.
              </span>
            )}
            <PrintButton label="Print record" />
          </div>
        </div>
      </header>

      {/* The section nav. Sticky under the app bar on a phone, at the top on
          a desktop. Anchors, so no JavaScript and every section is a link. */}
      <nav
        aria-label="Sections"
        className="no-print sticky top-[var(--app-bar-h)] z-20 -mx-4 flex gap-2 overflow-x-auto bg-[var(--color-surface-muted)] px-4 py-2 md:top-0 md:mx-0 md:px-0"
      >
        {sections.map(([key, label]) => (
          // A selection chip, not a filter pill: the repo sizes "picking" at
          // 44px, and on a phone this row IS how you move around the record.
          <a key={key} href={`#${key}`} className={`${chip()} whitespace-nowrap`}>
            {label}
          </a>
        ))}
      </nav>

      {/* ------------------------------------------------------ overview */}
      <section id="overview" className="scroll-mt-28 grid gap-5 md:gap-6 lg:grid-cols-2">
        <Card title="How complete is this record">
          <div className="flex items-center gap-3">
            <ProgressBar
              value={score.filled}
              max={score.total}
              label={`${name}: record completeness`}
              tone={
                score.percent >= 80
                  ? "bg-[var(--color-success)]"
                  : score.percent >= 50
                    ? "bg-[var(--color-warning)]"
                    : "bg-[var(--color-danger)]"
              }
              className="h-2 flex-1"
            />
            <span className="font-mono text-sm">
              {score.filled}/{score.total}
            </span>
          </div>
          {missing.length > 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              Still missing:{" "}
              {missing.map((key, index) => (
                <span key={key}>
                  {index > 0 ? ", " : ""}
                  <a href="#details" className="text-[var(--color-warning-fg)] hover:underline">
                    {TRACKED_LABELS[key]}
                  </a>
                </span>
              ))}
              .
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Every tracked field is filled in.</p>
          )}
          {waiting.length > 0 ? (
            <p className="mt-3 text-sm text-[var(--color-warning-fg)]">
              {waiting.length === 1
                ? "A teacher's correction is waiting"
                : `${waiting.length} teacher corrections are waiting`}{" "}
              in{" "}
              <Link href="/review" className="underline">
                review
              </Link>
              .
            </p>
          ) : null}
        </Card>

        <Card title="Also on this number">
          {siblings.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              No other child shares this family&rsquo;s numbers.
            </p>
          ) : (
            <ul className="space-y-2">
              {siblings.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/students/${encodeURIComponent(row.id)}`}
                    className="flex items-center gap-3 rounded-[var(--radius-control)] hover:bg-[var(--color-surface-muted)]"
                  >
                    <Avatar pathname={row.photoPath} name={titleCaseName(row.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{titleCaseName(row.name)}</span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {row.classLabel}
                        {row.rollNo ? ` · Roll ${row.rollNo}` : ""}
                        {row.status !== "active" ? ` · ${row.status}` : ""}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                      {row.phone === student.phone || row.phone === student.altPhone ? row.phone : row.altPhone}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Usually siblings. A number is a household&rsquo;s, not a child&rsquo;s.
          </p>
        </Card>
      </section>

      {/* ------------------------------------------------------- details */}
      <section id="details" className="scroll-mt-28 space-y-5 md:space-y-6">
        {!canEdit ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            Read-only for your role. Correcting master data takes the same
            permission as approving a teacher&rsquo;s correction into it.
          </p>
        ) : null}
        <div className="grid gap-5 md:gap-6 lg:grid-cols-2">
          {EDIT_SECTIONS.map((section) => {
            const own = sectionFields(fields, section);
            const fromFiles = describeSources(own.map((field) => lines.get(field.column) ?? null));
            return (
              <Card key={section.key} title={section.title}>
                <dl className="space-y-2 text-sm">
                  {own.map((field) => (
                    <ReadRow key={field.column} field={field} hint={hints.get(field.column)} pending={pendingByColumn.get(field.column)} />
                  ))}
                </dl>
                {fromFiles ? (
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">{fromFiles}</p>
                ) : null}
                {canEdit ? (
                  /* CLOSED, the card reads as a record. Open, it is the editor —
                     the same idiom as Settings → Teachers: editing is a deliberate
                     tap rather than a box under every value on a screen people
                     open mainly to read. */
                  <details className="no-print mt-4 border-t border-[var(--color-border)] pt-3">
                    <summary className="min-h-[var(--tap-min)] cursor-pointer list-none text-sm font-medium text-[var(--color-brand-600)]">
                      Edit {section.title.toLowerCase()} ▾
                    </summary>
                    <div className="mt-3">
                      <StudentEditForm
                        studentId={student.id}
                        fields={own}
                        pending={pendingByColumn}
                        provenance={hints}
                      />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------- documents */}
      <section id="documents" className="scroll-mt-28">
        <DocumentsCard studentId={student.id} documents={parts.documents} canEdit={canEdit} />
      </section>

      {/* --------------------------------------------------------- marks */}
      <section id="marks" className="scroll-mt-28">
        <Card title="Marks" flush>
          {marks.subjects.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-ink-muted)]">
              No marks entered yet. They arrive here as teachers enter them — see{" "}
              <Link href="/marks" className="text-[var(--color-brand-600)] hover:underline">
                Marks
              </Link>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Subject</th>
                    {marks.periods.map((period) => (
                      <th key={period} className="px-4 py-2 text-right font-mono font-medium normal-case tracking-normal">
                        {period}
                      </th>
                    ))}
                    {marks.periods.length > 1 ? <th className="px-4 py-2 font-medium">Trend</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {marks.subjects.map((subject) => (
                    <tr key={subject.key} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2">
                        {subject.label.replace(/^FA /, "")}
                        {subject.outOf ? (
                          <span className="block text-xs text-[var(--color-ink-muted)]">out of {subject.outOf}</span>
                        ) : null}
                      </td>
                      {subject.values.map((value, index) => (
                        <td key={marks.periods[index]} className="px-4 py-2 text-right align-top">
                          {value === null ? (
                            <span className="text-[var(--color-ink-faint)]">—</span>
                          ) : (
                            <span className="inline-flex flex-col items-end gap-1">
                              <span className="font-mono">{value}</span>
                              {subject.outOf ? (
                                <ProgressBar
                                  value={value}
                                  max={subject.outOf}
                                  label={`${subject.label} ${marks.periods[index]}: ${value} of ${subject.outOf}`}
                                  tone={
                                    value / subject.outOf >= 0.6
                                      ? "bg-[var(--color-success)]"
                                      : value / subject.outOf >= 0.33
                                        ? "bg-[var(--color-warning)]"
                                        : "bg-[var(--color-danger)]"
                                  }
                                  className="h-1 w-12"
                                />
                              ) : null}
                            </span>
                          )}
                        </td>
                      ))}
                      {marks.periods.length > 1 ? (
                        <td className="px-4 py-2 align-middle">
                          <Sparkline
                            points={subject.values.filter((v): v is number => v !== null)}
                            width={72}
                            height={22}
                            label={`${subject.label} across ${marks.periods.length} periods`}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ------------------------------------------------------ timeline */}
      <section id="timeline" className="scroll-mt-28">
        <Card title="Timeline" flush>
          <Timeline
            events={events}
            studentName={name}
            empty={
              <>
                Nothing has happened to this record yet. Values loaded by import
                do not appear here — the timeline records what a named person
                asked, answered, decided or typed, and an import is none of those.
              </>
            }
          />
        </Card>
      </section>
    </div>
  );
}

/** One line of a section's read view: label, value, and where the value came from. */
function ReadRow({ field, hint, pending }: { field: EditField; hint?: string; pending?: string }) {
  const empty = field.value === "";
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-[var(--color-ink-muted)]">{field.label}</dt>
      <dd className="min-w-0">
        <span className={empty ? "text-[var(--color-warning)]" : "font-medium"}>
          {empty ? "missing" : field.value}
        </span>
        {pending ? (
          <span className="block text-xs text-[var(--color-warning)]">{pending}</span>
        ) : hint ? (
          <span className="block text-xs text-[var(--color-ink-faint)]">{hint}</span>
        ) : null}
      </dd>
    </div>
  );
}
