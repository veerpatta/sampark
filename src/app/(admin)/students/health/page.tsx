import Link from "next/link";
import {
  backfillToday,
  hasSnapshotFor,
  healthByClass,
  toHeatmap,
  trend,
  trendByClass,
  withToday,
  worstClasses,
} from "@/lib/data-health";
import { Card } from "@/components/admin/Card";
import { Heatmap } from "@/components/admin/Heatmap";
import { PageHeader } from "@/components/admin/PageHeader";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { Sparkline } from "@/components/admin/Sparkline";
import { btn } from "@/components/ui/controls";
import { todayISO } from "@/lib/today";

export const metadata = { title: "Data health — Sampark" };
export const dynamic = "force-dynamic";

const DAYS = 30;

/**
 * Where the holes are, class by class, and whether they are closing.
 *
 * The board answers "which children" and this answers "which classes, which
 * fields" — the question that decides what the next round is about and who it
 * goes to. Every cell links back to the board filtered to exactly that hole.
 */
export default async function DataHealthPage() {
  const today = todayISO();

  const [rows, byClass, school, snapshotted] = await Promise.all([
    healthByClass(),
    trendByClass(DAYS),
    trend(DAYS),
    hasSnapshotFor(today),
  ]);
  const grid = toHeatmap(rows);
  const worst = worstClasses(rows, 3, grid);

  // A missed cron costs the trend a point; the first visit of the day puts it
  // back, from the rows just read and after them, so nothing waits on it.
  await backfillToday(snapshotted, rows);
  const first = school[0];
  const last = school[school.length - 1];
  const moved = first && last && first.day !== last.day ? last.percent - first.percent : null;

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Data health"
        subtitle={
          rows.length === 0
            ? "No active students on record yet."
            : `${grid.school.percent}% of the twelve tracked fields are filled across ${grid.classes.length} classes${
                moved === null ? "" : moved === 0 ? " — unchanged over the last month" : ` — ${moved > 0 ? "up" : "down"} ${Math.abs(moved)} points over the last ${DAYS} days`
              }.`
        }
        actions={
          <Link href="/requests/bulk" className={btn({ tone: "primary" })}>
            Send a round
          </Link>
        }
      />

      <div className="grid gap-5 md:gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card title="The school, over time">
          <div className="flex items-end gap-4">
            <span className="text-display font-semibold">{grid.school.percent}%</span>
            <Sparkline
              points={withToday(school, today, grid.school.percent)}
              width={200}
              height={44}
              label={`School completeness over the last ${DAYS} days`}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            {school.length < 2
              ? "The trend draws itself once there is more than one day of history. A snapshot is taken every morning."
              : `${school.length} days of history, from ${school[0]!.day}.`}
          </p>
          {worst.length > 0 ? (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
                Furthest behind
              </h3>
              <ul className="mt-2 space-y-2">
                {worst.map((row) => (
                  <li key={row.classLabel}>
                    <ClassRow {...row} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>

        <Card title="Each class, over time">
          {grid.classes.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">Nothing to show yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {grid.classes.map((classLabel) => {
                const total = grid.classTotal(classLabel);
                const series = byClass.get(classLabel) ?? [];
                return (
                  <li key={classLabel}>
                    <ClassRow
                      classLabel={classLabel}
                      {...total}
                      trend={withToday(series, today, total.percent)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="What is missing, by class and field">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing to show yet.</p>
        ) : (
          <Heatmap grid={grid} />
        )}
      </Card>
    </div>
  );
}

/**
 * One class: how full its records are, and where that is going.
 *
 * THE WHOLE ROW IS THE LINK. It was a 24px-wide label beside a bar, which on a
 * phone is a 20px-tall target sitting in a 48px space — the office was aiming
 * at the class name. Now the row itself is the target, and the density comes
 * back at `md` where there is a pointer.
 */
function ClassRow({
  classLabel,
  filled,
  total,
  percent,
  trend,
}: {
  classLabel: string;
  filled: number;
  total: number;
  percent: number;
  trend?: number[];
}) {
  return (
    <Link
      href={`/students?class=${encodeURIComponent(classLabel)}&sort=complete`}
      className="flex min-h-[var(--tap-min)] items-center gap-3 rounded-[var(--radius-control)] px-1 text-sm hover:bg-[var(--color-surface-muted)] md:min-h-0 md:py-1.5"
    >
      <span className="w-24 shrink-0 font-medium">{classLabel}</span>
      <ProgressBar
        value={filled}
        max={total}
        label={`${classLabel}: ${percent}% complete`}
        tone={barTone(percent)}
        className="h-1.5 flex-1"
      />
      <span className="w-10 text-right font-mono text-xs">{percent}%</span>
      {trend ? (
        <Sparkline
          points={trend}
          width={72}
          height={20}
          label={`${classLabel} over the last ${DAYS} days`}
          className="hidden sm:block"
        />
      ) : null}
    </Link>
  );
}

/** The three cut-offs the students board's own completeness bar uses. */
export function barTone(percent: number): string {
  return percent >= 80
    ? "bg-[var(--color-success)]"
    : percent >= 50
      ? "bg-[var(--color-warning)]"
      : "bg-[var(--color-danger)]";
}
