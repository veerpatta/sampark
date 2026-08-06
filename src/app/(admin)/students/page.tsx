import Link from "next/link";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { listClassLabels, listStudents } from "@/lib/students";
import { titleCaseName } from "@/lib/classes";
import { DataTable, type Column } from "@/components/admin/DataTable";

export const metadata = { title: "Students — Sampark" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * The master record, searchable and filterable by class.
 *
 * Search and filter live in the query string rather than component state, so a
 * particular view is a link the office can send to itself.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; class?: string; page?: string }>;
}) {
  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const classLabel = params.class?.trim() ?? "";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [session, { students, total }, classes] = await Promise.all([
    currentUser(),
    listStudents({
      search,
      classLabel: classLabel || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listClassLabels(),
  ]);

  const canImport = session ? canApproveIntoMaster(session.role) : false;

  // Name is the card's title, class its subtitle; the identifiers become
  // labelled pairs below rather than columns off the right edge of a phone.
  const columns: Column<(typeof students)[number]>[] = [
    {
      key: "class",
      header: "Class",
      role: "secondary",
      cell: (student) =>
        `${student.classLabel}${student.section ? ` ${student.section}` : ""}`,
      cellClassName: "whitespace-nowrap",
    },
    {
      key: "roll",
      header: "Roll",
      cell: (student) => student.rollNo ?? "—",
      cellClassName: "font-mono text-xs",
    },
    {
      key: "name",
      header: "Name",
      role: "primary",
      cell: (student) => (
        <Link
          href={`/students/${encodeURIComponent(student.id)}`}
          className="hover:text-[var(--color-brand-600)] hover:underline"
        >
          {titleCaseName(student.name)}
        </Link>
      ),
      cellClassName: "font-medium",
    },
    {
      key: "father",
      header: "Father",
      cell: (student) => student.fatherName ?? "—",
      cellClassName: "text-[var(--color-ink-muted)]",
    },
    {
      key: "phone",
      header: "Mobile",
      cell: (student) =>
        student.phone ?? (
          <span className="text-[var(--color-warning)]">missing</span>
        ),
      cellClassName: "font-mono text-xs",
    },
    {
      key: "id",
      header: "Student ID",
      cell: (student) => student.id,
      cellClassName: "font-mono text-xs text-[var(--color-ink-muted)]",
    },
    {
      key: "sr",
      header: "SR",
      cell: (student) => student.srNo ?? "—",
      cellClassName: "font-mono text-xs text-[var(--color-ink-muted)]",
    },
  ];
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {total.toLocaleString("en-IN")} record{total === 1 ? "" : "s"}
            {classLabel ? ` in ${classLabel}` : ""}
            {search ? ` matching “${search}”` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <a
              href={`/api/export/students.xlsx${classLabel ? `?class=${encodeURIComponent(classLabel)}` : ""}`}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
            >
              Export {classLabel ? classLabel : "all"} to Excel
            </a>
          ) : null}
          {canImport ? (
            <Link
              href="/students/import"
              className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
            >
              Import from PSP
            </Link>
          ) : null}
        </div>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            Search
          </span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Name, student ID, SR number, mobile"
            className="mt-1 w-72 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            Class
          </span>
          <select
            name="class"
            defaultValue={classLabel}
            className="mt-1 w-40 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="">All classes</option>
            {classes.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          Apply
        </button>

        {search || classLabel ? (
          <Link
            href="/students"
            className="py-2 text-sm text-[var(--color-ink-muted)] hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {students.length === 0 ? (
        <EmptyState hasFilter={Boolean(search || classLabel)} canImport={canImport} />
      ) : (
        <DataTable
          columns={columns}
          rows={students}
          rowKey={(student) => student.id}
          href={(student) => `/students/${encodeURIComponent(student.id)}`}
        />
      )}

      {lastPage > 1 ? (
        <nav className="flex items-center gap-4 text-sm">
          <PageLink
            page={page - 1}
            disabled={page <= 1}
            search={search}
            classLabel={classLabel}
          >
            ← Previous
          </PageLink>
          <span className="text-[var(--color-ink-muted)]">
            Page {page} of {lastPage}
          </span>
          <PageLink
            page={page + 1}
            disabled={page >= lastPage}
            search={search}
            classLabel={classLabel}
          >
            Next →
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  page,
  disabled,
  search,
  classLabel,
  children,
}: {
  page: number;
  disabled: boolean;
  search: string;
  classLabel: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-[var(--color-border)]">{children}</span>;
  }
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (classLabel) params.set("class", classLabel);
  params.set("page", String(page));
  return (
    <Link
      href={`/students?${params}`}
      className="text-[var(--color-brand-600)] hover:underline"
    >
      {children}
    </Link>
  );
}

function EmptyState({
  hasFilter,
  canImport,
}: {
  hasFilter: boolean;
  canImport: boolean;
}) {
  if (hasFilter) {
    return (
      <p className="p-6 text-sm text-[var(--color-ink-muted)]">
        No students match that search.
      </p>
    );
  }
  return (
    <div className="p-6 text-sm text-[var(--color-ink-muted)]">
      <p>No students loaded yet.</p>
      {canImport ? (
        <p className="mt-2">
          Start with a PSP export —{" "}
          <Link
            href="/students/import"
            className="font-medium text-[var(--color-brand-600)] hover:underline"
          >
            import a CSV or XLSX
          </Link>
          . One class is enough to try it.
        </p>
      ) : null}
    </div>
  );
}
