import Link from "next/link";
import { FIELD_HEADINGS, MISSING_FIELD_FOR, type Heatmap as HeatmapData } from "@/lib/data-health";

/**
 * Where the holes are: class down the side, field across the top.
 *
 * TWO SHAPES, AND THE PHONE ONE IS NOT THE TABLE. Twelve columns is 900px of
 * grid, and a phone showed four of them with the other eight off the right
 * edge — so the office could not see that Aadhaar or the photograph were
 * missing at all. DataTable's rule applies here too: a horizontally scrolling
 * table on a 390px screen is a defeat.
 *
 * Below `md` each class becomes a card listing only the fields it still has
 * gaps in, worst first, as chips carrying the count. That answers the same
 * question — where is the work — in the form a thumb can act on, and each chip
 * is the same link the cell would have been. A class with nothing missing says
 * so rather than rendering twelve ticks.
 *
 * At `md` and up the table returns, because on a laptop the grid IS the
 * insight: you read down a column to find the field the whole school is bad at.
 */
export function Heatmap({ grid }: { grid: HeatmapData }) {
  return (
    <>
      {/* ------------------------------------------------------ below md */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {grid.classes.map((classLabel) => {
          const total = grid.classTotal(classLabel);
          const gaps = grid.fields
            .map((field) => ({ field, ...grid.cell(classLabel, field) }))
            .filter((cell) => cell.total - cell.filled > 0)
            .sort((a, b) => b.total - b.filled - (a.total - a.filled));

          return (
            <li
              key={classLabel}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/students?class=${encodeURIComponent(classLabel)}&sort=complete`}
                  className="inline-flex min-h-[var(--tap-min)] items-center font-medium hover:underline"
                >
                  {classLabel}
                </Link>
                <span className={`font-mono text-sm ${textTone(total.percent)}`}>{total.percent}%</span>
              </div>

              {gaps.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-muted)]">
                  Nothing missing — every tracked field is filled.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {gaps.map((cell) => (
                    <Link
                      key={cell.field}
                      href={`/students?class=${encodeURIComponent(classLabel)}&missing=${MISSING_FIELD_FOR[cell.field]}&sort=class`}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-chip)] px-3 text-sm ${tone(cell.percent)}`}
                    >
                      {FIELD_HEADINGS[cell.field]}
                      <span className="font-mono text-xs">{cell.total - cell.filled}</span>
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ------------------------------------------------------- md and up */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="sticky left-0 bg-[var(--color-surface)] px-3 py-2 font-medium">Class</th>
              {grid.fields.map((field) => (
                <th key={field} className="px-2 py-2 text-center font-medium">
                  {FIELD_HEADINGS[field]}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">All</th>
            </tr>
          </thead>
          <tbody>
            {grid.classes.map((classLabel) => {
              const total = grid.classTotal(classLabel);
              return (
                <tr key={classLabel} className="border-t border-[var(--color-border)]">
                  <th
                    scope="row"
                    className="sticky left-0 whitespace-nowrap bg-[var(--color-surface)] px-3 py-1.5 text-left font-medium"
                  >
                    <Link
                      href={`/students?class=${encodeURIComponent(classLabel)}&sort=complete`}
                      className="hover:underline"
                    >
                      {classLabel}
                    </Link>
                  </th>
                  {grid.fields.map((field) => {
                    const cell = grid.cell(classLabel, field);
                    const missing = cell.total - cell.filled;
                    return (
                      <td key={field} className="p-1 text-center">
                        <Link
                          href={`/students?class=${encodeURIComponent(classLabel)}&missing=${MISSING_FIELD_FOR[field]}&sort=class`}
                          title={`${classLabel} · ${FIELD_HEADINGS[field]}: ${cell.filled} of ${cell.total} filled, ${missing} missing`}
                          className={`block rounded-[var(--radius-control)] px-1 py-1.5 font-mono text-xs hover:outline hover:outline-1 hover:outline-[var(--color-brand-600)] ${tone(cell.percent)}`}
                        >
                          {missing === 0 ? "✓" : missing}
                        </Link>
                      </td>
                    );
                  })}
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${textTone(total.percent)}`}>
                    {total.percent}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--color-border)] text-xs text-[var(--color-ink-muted)]">
              <th scope="row" className="sticky left-0 bg-[var(--color-surface)] px-3 py-2 text-left font-medium">
                School
              </th>
              {grid.fields.map((field) => {
                const total = grid.fieldTotal(field);
                return (
                  <td key={field} className="px-2 py-2 text-center font-mono">
                    {total.percent}%
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right font-mono font-medium text-[var(--color-ink)]">
                {grid.school.percent}%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Each number is how many children in that class are missing that field. Tap one to open them.
      </p>
    </>
  );
}

/** The board's own three cut-offs, so the two screens agree about what "bad" is. */
function tone(percent: number): string {
  if (percent >= 80) return "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]";
  if (percent >= 50) return "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]";
  return "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
}

function textTone(percent: number): string {
  if (percent >= 80) return "text-[var(--color-success)]";
  if (percent >= 50) return "text-[var(--color-warning-fg)]";
  return "text-[var(--color-danger)]";
}
