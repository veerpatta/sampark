import Link from "next/link";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { listFacets, listStudents } from "@/lib/students";
import { compareClassLabels, titleCaseName } from "@/lib/classes";
import { completeness } from "@/lib/completeness";
import {
  MISSING_FIELDS,
  MISSING_LABELS,
  PAGE_SIZES,
  SORT_LABELS,
  SORTS,
  parseFilters,
  toSearchParams,
  type StudentSearchParams,
} from "@/lib/student-filters";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterBar, type ChipGroup } from "@/components/admin/FilterBar";
import { StudentPhoto } from "@/components/admin/StudentPhoto";
import { Avatar } from "@/components/admin/Avatar";
import { PageHeader } from "@/components/admin/PageHeader";
import { btn, eyebrow, field } from "@/components/ui/controls";
import { HouseChip } from "@/components/HouseChip";

export const metadata = { title: "Students — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The master record, sliced any way the office needs it.
 *
 * FILTER STATE LIVES IN THE QUERY STRING, which is the existing decision here
 * and the reason a particular view is a link the office can send to itself.
 * Every filter, the sort and the page size are in it, and so is the Excel
 * export — pressing Export on a filtered board used to hand over a different
 * set of children than the one on screen, because it read `?class=` alone.
 *
 * The board defaults to ACTIVE students only. It never used to filter on status
 * at all, so children who had left were mixed in with no way to tell; the
 * result line now says which it is showing rather than changing that silently.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<StudentSearchParams>;
}) {
  const params = await searchParams;
  const { query, page, size, active } = parseFilters(params);

  const [session, { students, total }, facets] = await Promise.all([
    currentUser(),
    listStudents(query),
    listFacets(),
  ]);

  const canImport = session ? canApproveIntoMaster(session.role) : false;
  const lastPage = Math.max(1, Math.ceil(total / size));
  const exportQuery = toSearchParams(params);

  const sorted = (map: Map<string, number>) => [...map.entries()].sort();
  const chip = (
    name: string,
    label: string,
    map: Map<string, number>,
    selected: string[] = [],
    order: [string, number][] = sorted(map),
  ): ChipGroup => ({
    name,
    label,
    selected,
    values: order.map(([value, count]) => ({ value, count })),
  });

  const primary: ChipGroup[] = [
    chip(
      "classes",
      "Class",
      facets.classes,
      query.classes ?? [],
      [...facets.classes.entries()].sort((a, b) =>
        compareClassLabels(a[0], b[0]),
      ),
    ),
    chip("houses", "House", facets.houses, query.houses ?? []),
    {
      name: "missing",
      label: "Missing",
      selected: query.missing ?? [],
      // The work list. Every count here is a number of children somebody still
      // has to chase, which is why this group sits with class and house rather
      // than behind the disclosure.
      values: MISSING_FIELDS.map((field) => ({
        value: field,
        label: MISSING_LABELS[field],
        count: facets.missing.get(field),
      })),
    },
  ];

  const secondary: ChipGroup[] = [
    chip("sections", "Section", facets.sections, query.sections ?? []),
    chip("routes", "Bus route", facets.routes, query.routes ?? []),
    chip("genders", "Gender", facets.genders, query.genders ?? []),
    chip("categories", "Category", facets.categories, query.categories ?? []),
    chip("villages", "Village", facets.villages, query.villages ?? []),
    chip("statuses", "Record status", facets.statuses, query.statuses ?? []),
  ];

  const columns: Column<(typeof students)[number]>[] = [
    {
      key: "photo",
      header: "",
      hideOnCard: true,
      cell: (student) => (
        <StudentPhoto
          pathname={student.photoPath}
          name={titleCaseName(student.name)}
        />
      ),
    },
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
      cell: (student) => titleCaseName(student.name),
      cellClassName: "font-medium",
    },
    {
      key: "house",
      header: "House",
      cell: (student) =>
        student.house ? (
          <HouseChip house={student.house} lang="en" />
        ) : (
          <span className="text-[var(--color-ink-muted)]">—</span>
        ),
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
      key: "complete",
      header: "Record",
      cell: (student) => <CompletenessBar student={student} />,
    },
    {
      key: "id",
      header: "Student ID",
      cell: (student) => student.id,
      cellClassName: "font-mono text-xs text-[var(--color-ink-muted)]",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        subtitle={`${total.toLocaleString("en-IN")} record${total === 1 ? "" : "s"}${
          query.statuses?.length ? "" : ", active only"
        }${active ? " matching these filters" : ""}`}
      />

      <QuickViews facets={facets} />

      <FilterBar primary={primary} secondary={secondary}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full sm:w-auto">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Search
            </span>
            <input
              name="q"
              defaultValue={query.search}
              placeholder="Name, ID, SR, admission no., mobile, father"
              className={`${field()} mt-1 sm:w-80`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Sort by
            </span>
            <select
              name="sort"
              defaultValue={query.sort}
              className={`${field()} mt-1 w-auto`}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {SORT_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Per page
            </span>
            <select
              name="size"
              defaultValue={String(size)}
              className={`${field()} mt-1 w-auto`}
            >
              {PAGE_SIZES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {active ? (
            <Link
              href="/students"
              className="inline-flex min-h-[var(--tap-min)] items-center text-sm text-[var(--color-ink-muted)] hover:underline"
            >
              Clear all
            </Link>
          ) : null}
        </div>
      </FilterBar>

      {students.length === 0 ? (
        <EmptyState hasFilter={active} canImport={canImport} />
      ) : (
        <DataTable
          columns={columns}
          rows={students}
          rowKey={(student) => student.id}
          href={(student) => `/students/${encodeURIComponent(student.id)}`}
          /* Nine columns is the right shape for a laptop and the wrong one for
             a thumb. What the office is doing on a phone is finding one child
             and seeing whether their record is any good, so the card is a face,
             a name, where they sit, and the two facts that decide whether this
             child needs chasing: a number, and how full the record is. */
          card={(student) => (
            <div className="flex items-center gap-3">
              <Avatar
                pathname={student.photoPath}
                name={titleCaseName(student.name)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">
                  {titleCaseName(student.name)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
                  {student.classLabel}
                  {student.section ? ` ${student.section}` : ""}
                  {student.rollNo ? ` · Roll ${student.rollNo}` : ""}
                  {student.fatherName ? ` · ${student.fatherName}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                  className={`font-mono text-xs ${
                    student.phone ? "" : "text-[var(--color-warning-fg)]"
                  }`}
                >
                  {student.phone ?? "no number"}
                </span>
                <CompletenessBar student={student} />
              </span>
            </div>
          )}
        />
      )}

      {lastPage > 1 ? (
        <nav className="flex items-center gap-4 text-sm">
          <PageLink page={page - 1} disabled={page <= 1} params={params}>
            ← Previous
          </PageLink>
          <span className="text-[var(--color-ink-muted)]">
            Page {page} of {lastPage}
          </span>
          <PageLink page={page + 1} disabled={page >= lastPage} params={params}>
            Next →
          </PageLink>
        </nav>
      ) : null}

      {/* Below the board rather than beside the heading. These act on the whole
          filtered set, so they only make sense once you have seen what the set
          is — and on a phone they were three buttons pushing the first child
          off the screen. */}
      {total > 0 || canImport ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
          {total > 0 ? (
            <a
              href={`/api/export/students.xlsx${exportQuery.size > 0 ? `?${exportQuery}` : ""}`}
              className={`${btn()} flex-1 sm:flex-none`}
            >
              Export these {total.toLocaleString("en-IN")} to Excel
            </a>
          ) : null}
          {/* The photographs are the slow part of that file — one blob read per
              child — so the way to get the columns in a hurry is offered next
              to it rather than left as an undocumented query parameter. */}
          {total > 0 ? (
            <a
              href={`/api/export/students.xlsx?${(() => {
                const fast = new URLSearchParams(exportQuery);
                fast.set("photos", "0");
                return fast;
              })()}`}
              className="inline-flex min-h-[var(--tap-min)] items-center px-2 text-sm text-[var(--color-ink-muted)] hover:underline"
            >
              without photos
            </a>
          ) : null}
          {canImport ? (
            <Link href="/students/import" className={btn({ tone: "primary" })}>
              Import
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One tap to the questions the office actually asks.
 *
 * These are nothing but query strings — the same filters, pre-built — so
 * anything reachable here is also reachable by hand, and a view worth keeping
 * is a link worth bookmarking. The counts come from the same facet query the
 * chips use, so a view promising 42 children opens on 42 children.
 */
function QuickViews({
  facets,
}: {
  facets: Awaited<ReturnType<typeof listFacets>>;
}) {
  const views = [
    ...MISSING_FIELDS.map((field) => ({
      href: `/students?missing=${field}&sort=class`,
      label: MISSING_LABELS[field],
      count: facets.missing.get(field) ?? 0,
    })),
    {
      href: "/students?statuses=left&statuses=tc_issued",
      label: "Left or TC issued",
      count:
        (facets.statuses.get("left") ?? 0) +
        (facets.statuses.get("tc_issued") ?? 0),
    },
  ].filter((view) => view.count > 0);

  if (views.length === 0) return null;

  return (
    <section>
      <h2 className={eyebrow()}>Work left</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {views.map((view) => (
          <Link
            key={view.href}
            href={view.href}
            className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-chip)] border border-[var(--color-warning)] bg-[var(--color-partial-bg)] px-3 text-sm font-medium text-[var(--color-warning-fg)] hover:bg-[var(--color-correct-bg)]"
          >
            {view.label}
            <span className="font-mono text-xs">{view.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * How much of this child's record the school holds.
 *
 * Twelve fields, one bar. It exists so "who should the next request be about"
 * is answerable by looking rather than by opening five hundred detail pages,
 * and it is the same count the "least complete first" sort orders by — see
 * lib/completeness.ts, which is the single list both read.
 */
function CompletenessBar({
  student,
}: {
  student: Parameters<typeof completeness>[0];
}) {
  const { filled, total, percent } = completeness(student);
  return (
    <span className="flex items-center gap-2" title={`${filled} of ${total} fields`}>
      <span className="h-1.5 w-11 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
        <span
          className={`block h-full rounded-full ${
            percent >= 80
              ? "bg-[var(--color-success)]"
              : percent >= 50
                ? "bg-[var(--color-warning)]"
                : "bg-[var(--color-danger)]"
          }`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="font-mono text-xs text-[var(--color-ink-muted)]">
        {filled}/{total}
      </span>
    </span>
  );
}

function PageLink({
  page,
  disabled,
  params,
  children,
}: {
  page: number;
  disabled: boolean;
  params: StudentSearchParams;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex min-h-[var(--tap-min)] items-center px-2 text-[var(--color-border)]">
        {children}
      </span>
    );
  }
  const search = toSearchParams(params, { page });
  return (
    <Link
      href={`/students?${search}`}
      className="inline-flex min-h-[var(--tap-min)] items-center px-2 text-[var(--color-brand-600)] hover:underline"
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
        No students match those filters.{" "}
        <Link href="/students" className="text-[var(--color-brand-600)] hover:underline">
          Clear them
        </Link>
        .
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
