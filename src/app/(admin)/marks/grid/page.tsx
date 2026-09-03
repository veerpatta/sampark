import Link from "next/link";
import { notFound } from "next/navigation";
import { isClassLabel, normaliseClassLabel, titleCaseName } from "@/lib/classes";
import {
  askedFor,
  buildMarksGrid,
  collectedMarks,
  listMarksPeriods,
  marksFieldDefs,
} from "@/lib/marks";
import { listClassRoster } from "@/lib/students";
import { Card } from "@/components/admin/Card";
import { PageHeader } from "@/components/admin/PageHeader";
import { btn, card, chip } from "@/components/ui/controls";

export const metadata = { title: "Marks grid — Sampark" };
export const dynamic = "force-dynamic";

/**
 * One class, one period, every child and every subject.
 *
 * /marks says who has entered what; this says which CHILDREN are still missing
 * a mark, which is the question a class teacher asks the subject teacher in
 * the staffroom. Blanks are tinted, not red — a mark not yet entered is
 * unfinished, not wrong — and the footer says what the class averages on each
 * subject so far, over the marks entered, never over the whole roll.
 *
 * Query string rather than path segments: a period is '2026-27/FA1', and a
 * slash in a dynamic segment is a fight not worth having.
 */
export default async function MarksGridPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; class?: string }>;
}) {
  const params = await searchParams;
  const period = params.period?.trim() ?? "";
  const classLabel = normaliseClassLabel(params.class ?? "");
  if (!period || !isClassLabel(classLabel)) notFound();

  const [roster, rows, asked, defs, periods] = await Promise.all([
    listClassRoster(classLabel),
    collectedMarks(period, classLabel),
    askedFor(period),
    marksFieldDefs(),
    listMarksPeriods(),
  ]);
  if (!periods.some((row) => row.period === period)) notFound();

  const subjects = [
    ...new Map(
      asked
        .filter((ask) => ask.classLabel === classLabel)
        .map((ask) => {
          const def = defs.get(ask.fieldKey);
          return [
            ask.fieldKey,
            { key: ask.fieldKey, label: def?.label ?? ask.subject, outOf: def?.outOf ?? null, sortOrder: def?.sortOrder ?? 100 },
          ] as const;
        }),
    ).values(),
  ];
  const grid = buildMarksGrid(roster, rows, subjects);
  const incomplete = grid.rows.filter((row) => row.blanks > 0).length;

  // The other classes this period was asked of, one tap away.
  const classes = [...new Set(asked.map((ask) => ask.classLabel))].sort();

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title={`${classLabel} · ${period}`}
        size="detail"
        subtitle={
          grid.subjects.length === 0
            ? "No marks were asked for this class in this period."
            : `${grid.rows.length} children, ${grid.subjects.length} subject${grid.subjects.length === 1 ? "" : "s"} — ${
                incomplete === 0 ? "every mark is in." : `${incomplete} still missing at least one mark.`
              }`
        }
        actions={
          <>
            <Link href={`/marks?period=${encodeURIComponent(period)}`} className={btn()}>
              Back to the board
            </Link>
            <a
              href={`/api/export/marks.xlsx?period=${encodeURIComponent(period)}&by=class`}
              className={btn({ tone: "primary" })}
            >
              Download by class
            </a>
          </>
        }
      />

      {classes.length > 1 ? (
        <nav aria-label="Class" className="flex flex-wrap gap-2">
          {classes.map((label) => (
            <Link
              key={label}
              href={`/marks/grid?period=${encodeURIComponent(period)}&class=${encodeURIComponent(label)}`}
              aria-current={label === classLabel ? "page" : undefined}
              className={chip({ on: label === classLabel, pill: true })}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* Per subject: how far the round has got. On a phone this is the
          header the table's footer cannot be — the averages have to be
          readable without reaching the far side of a grid. */}
      {grid.subjects.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grid.subjects.map((subject) => (
            <div key={subject.key} className={`${card()} p-3`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{subject.label.replace(/^FA /, "")}</span>
                <span className="font-mono text-sm">
                  {subject.entered}/{grid.rows.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                {subject.average === null ? "nothing entered yet" : `average ${subject.average}`}
                {subject.outOf ? ` · out of ${subject.outOf}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <Card title="Every child, every subject" flush>
        {grid.subjects.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">Nothing to show.</p>
        ) : (
          <>
            {/* ------------------------------------------------ below md */}
            <ul className="divide-y divide-[var(--color-border)] md:hidden">
              {grid.rows.map((row) => (
                <li key={row.studentId} className="px-4 py-2.5">
                  <Link
                    href={`/students/${encodeURIComponent(row.studentId)}#marks`}
                    className="flex min-h-[var(--tap-min)] items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{titleCaseName(row.name)}</span>
                    {row.rollNo ? (
                      <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                        Roll {row.rollNo}
                      </span>
                    ) : null}
                  </Link>
                  {/* Every subject, including the blanks — the blanks are the
                      reason anyone opens this screen. */}
                  <div className="flex flex-wrap gap-1.5">
                    {grid.subjects.map((subject) => {
                      const value = row.marks[subject.key];
                      const blank = value === null || value === undefined;
                      return (
                        <span
                          key={subject.key}
                          className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] px-2.5 py-1 text-xs ${
                            blank
                              ? "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]"
                              : "bg-[var(--color-surface-muted)]"
                          }`}
                        >
                          {subject.label.replace(/^FA /, "")}
                          <span className="font-mono font-medium">{blank ? "—" : value}</span>
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>

            {/* ------------------------------------------------- md and up */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="sticky left-0 bg-[var(--color-surface)] px-4 py-2 font-medium">Roll</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    {grid.subjects.map((subject) => (
                      <th key={subject.key} className="px-3 py-2 text-right font-medium">
                        {subject.label.replace(/^FA /, "")}
                        {subject.outOf ? (
                          <span className="block font-mono text-[10px] normal-case tracking-normal">
                            / {subject.outOf}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <tr key={row.studentId} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="sticky left-0 bg-[var(--color-surface)] px-4 py-1.5 font-mono text-xs text-[var(--color-ink-muted)]">
                        {row.rollNo ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5">
                        <Link href={`/students/${encodeURIComponent(row.studentId)}#marks`} className="hover:underline">
                          {titleCaseName(row.name)}
                        </Link>
                      </td>
                      {grid.subjects.map((subject) => {
                        const value = row.marks[subject.key];
                        return (
                          <td key={subject.key} className="px-3 py-1.5 text-right font-mono">
                            {value === null || value === undefined ? (
                              <span className="inline-block rounded bg-[var(--color-correct-bg)] px-2 text-[var(--color-correct-fg)]">
                                —
                              </span>
                            ) : (
                              value
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-[var(--color-border)] text-xs text-[var(--color-ink-muted)]">
                  <tr>
                    <td className="sticky left-0 bg-[var(--color-surface)] px-4 py-2" />
                    <td className="px-4 py-2 font-medium">Entered · average</td>
                    {grid.subjects.map((subject) => (
                      <td key={subject.key} className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        {subject.entered}/{grid.rows.length}
                        {subject.average !== null ? ` · ${subject.average}` : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
