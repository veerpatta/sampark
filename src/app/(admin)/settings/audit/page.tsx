import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Audit log — Sampark" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * The change log.
 *
 * Success criterion 5 from the plan: every change to a student record has a
 * name and a timestamp attached to it. This is the screen that proves it.
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

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
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
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {total.toLocaleString("en-IN")} decision{total === 1 ? "" : "s"}
          {student ? ` for ${student}` : ""} · append-only, enforced by database
          grants rather than by this application behaving itself
        </p>
      </header>

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {entries.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-muted)]">
            Nothing has been approved or rejected yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Field</th>
                <th className="px-4 py-3">Change</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr
                  key={row.entry.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-[var(--color-ink-muted)]">
                    {formatWhen(row.entry.decidedAt)}
                  </td>
                  <td className="px-4 py-2">
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
                  </td>
                  <td className="px-4 py-2 text-[var(--color-ink-muted)]">
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
                    {row.entry.note ? (
                      <div className="mt-0.5 font-sans text-xs text-[var(--color-ink-muted)]">
                        {row.entry.note}
                      </div>
                    ) : null}
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
                  <td className="px-4 py-2 text-[var(--color-ink-muted)]">
                    {row.decidedByName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
