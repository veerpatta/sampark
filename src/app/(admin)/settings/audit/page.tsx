import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { decisionChip } from "@/components/ui/controls";
import { redirect } from "next/navigation";

export const metadata = { title: "Audit log — Sampark" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * The change log: every DECISION taken about the master record, and every
 * direct EDIT made to it.
 *
 * Success criterion 5 from the plan: every change to a student record has a
 * name and a timestamp attached to it. This is the screen that proves it.
 *
 * Two shapes of row live here now. `approved` and `rejected` are verdicts on
 * something a teacher proposed, and carry the submission they were about.
 * `edited` is the office typing into /students/[id] directly: no submission,
 * because nobody proposed anything — submission_id is NULL and that is the
 * whole distinction. Both name a user and a time, which is all this screen ever
 * claimed to guarantee.
 *
 * MARKS ARE NOT HERE, and their absence is not a gap. A change_log row records
 * that a named user decided something, and nobody decides a mark — it is
 * written the moment the teacher submits it (lib/submissions.ts). The name that
 * matters for a mark is the teacher's, and she has no users row to reference,
 * so a row here could only ever name an office clerk who did not do the work.
 * A mark's own trail is the append-only submission behind it and the request it
 * came from; both are surfaced on the student's page and on /marks.
 *
 * Read-only, and it could not be anything else — `app_rw` holds no UPDATE or
 * DELETE on change_log, so there is no code path from this application that
 * could edit what you are looking at.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; student?: string }>;
}) {
  const session = await currentUser();
  if (!session) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const student = params.student?.trim();

  const where = student
    ? eq(schema.changeLog.studentId, student)
    : undefined;

  const [entries, [count]] = await Promise.all([
    db
      .select({
        entry: schema.changeLog,
        decidedByName: schema.users.name,
        studentName: schema.students.name,
        classLabel: schema.students.classLabel,
        fieldLabel: schema.fieldDefs.labelEn,
      })
      .from(schema.changeLog)
      .innerJoin(schema.users, eq(schema.users.id, schema.changeLog.decidedBy))
      .leftJoin(
        schema.students,
        eq(schema.students.id, schema.changeLog.studentId),
      )
      .leftJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.changeLog.fieldKey),
      )
      .where(where)
      .orderBy(desc(schema.changeLog.decidedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.changeLog)
      .where(where),
  ]);

  const total = count?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The change itself is the card's title on a phone — it is the only column
  // anyone actually reads a log for.
  const columns: Column<(typeof entries)[number]>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => formatWhen(row.entry.decidedAt),
      cellClassName: "whitespace-nowrap text-xs text-[var(--color-ink-muted)]",
    },
    {
      key: "student",
      header: "Student",
      role: "secondary",
      cell: (row) => (
        <>
          <Link
            href={`/settings/audit?student=${encodeURIComponent(row.entry.studentId)}`}
            className="font-medium hover:underline"
          >
            {row.studentName ?? row.entry.studentId}
          </Link>
          <div className="font-mono text-xs text-[var(--color-ink-muted)]">
            {row.classLabel ? `${row.classLabel} · ` : ""}
            {row.entry.studentId}
          </div>
        </>
      ),
    },
    {
      key: "field",
      header: "Field",
      cell: (row) => row.fieldLabel ?? row.entry.fieldKey,
      cellClassName: "text-[var(--color-ink-muted)]",
    },
    {
      key: "change",
      header: "Change",
      role: "primary",
      cell: (row) => (
        <span className="font-mono text-xs">
          <span className="line-through opacity-60">
            {row.entry.fromValue ?? "empty"}
          </span>
          <span className="mx-2" aria-hidden>
            &rarr;
          </span>
          <span className="font-medium">{row.entry.toValue ?? "empty"}</span>
          {row.entry.note ? (
            <span className="mt-0.5 block font-sans text-xs text-[var(--color-ink-muted)]">
              {row.entry.note}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "decision",
      header: "Decision",
      cell: (row) => (
        <span className={decisionChip(row.entry.decision)}>{row.entry.decision}</span>
      ),
    },
    {
      key: "by",
      header: "By",
      cell: (row) => row.decidedByName,
      cellClassName: "text-[var(--color-ink-muted)]",
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-display font-semibold">Audit log</h1>
        {/* Sibling settings pages, on a pointer only — below md the Settings
            tab lands on an index of all six. See settings/users/page.tsx. */}
        <div className="mt-1 hidden flex-wrap items-baseline gap-3 md:flex">
          <Link
            href="/settings/fields"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            field registry
          </Link>
          <Link
            href="/settings/teachers"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            teachers
          </Link>
          <Link
            href="/settings/subjects"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            subjects
          </Link>
        </div>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          {total.toLocaleString("en-IN")} entr{total === 1 ? "y" : "ies"}
          {student ? ` for ${student}` : ""} about the master record —
          decisions on what teachers proposed, and edits the office typed
          directly · append-only, enforced by database grants rather than by
          this application behaving itself · marks are neither decided nor
          typed here, so they are on{" "}
          <Link
            href="/marks"
            className="text-[var(--color-brand-600)] hover:underline"
          >
            Marks
          </Link>{" "}
          instead
        </p>
      </header>

      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(row) => String(row.entry.id)}
        empty="Nothing has been decided or edited yet."
      />

      {student ? (
        <Link
          href="/settings/audit"
          className="text-sm text-[var(--color-brand-600)] hover:underline"
        >
          ← every student
        </Link>
      ) : null}

      {lastPage > 1 ? (
        <nav className="flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1, student)}
              className="text-[var(--color-brand-600)] hover:underline"
            >
              ← Newer
            </Link>
          ) : (
            <span className="text-[var(--color-border)]">← Newer</span>
          )}
          <span className="text-[var(--color-ink-muted)]">
            Page {page} of {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={pageHref(page + 1, student)}
              className="text-[var(--color-brand-600)] hover:underline"
            >
              Older →
            </Link>
          ) : (
            <span className="text-[var(--color-border)]">Older →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function pageHref(page: number, student?: string): string {
  const params = new URLSearchParams();
  if (student) params.set("student", student);
  params.set("page", String(page));
  return `/settings/audit?${params}`;
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}
