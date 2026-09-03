import Link from "next/link";
import { FIELD_HEADINGS, MISSING_FIELD_FOR, type Heatmap as HeatmapData } from "@/lib/data-health";

/**
 * Class down the side, field across the top, a tinted count in each cell.
 *
 * Every cell is a link to the board filtered to exactly that hole, because a
 * number the office cannot act on from where she reads it is a number she has
 * to go and find again. The tints are the three completeness cut-offs the
 * board's own bar uses (80 / 50), so the two agree about what "bad" is.
 *
 * Server-rendered HTML, no library. It scrolls sideways inside its own box on
 * a phone rather than the page doing so — twelve columns is genuinely wide,
 * and this is the one screen where that is the content.
 */
export function Heatmap({ grid }: { grid: HeatmapData }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
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
      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        Each cell is how many children in that class are missing that field. Tap one to open them.
      </p>
    </div>
  );
}

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
