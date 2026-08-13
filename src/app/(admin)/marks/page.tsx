import Link from "next/link";
import {
  askedFor,
  collectedMarks,
  listMarksPeriods,
  summariseMarks,
  UNATTRIBUTED,
  type SummaryRow,
} from "@/lib/marks";
import { countByClass } from "@/lib/students";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader } from "@/components/admin/PageHeader";
import { Card } from "@/components/admin/Card";
import { btn, chip } from "@/components/ui/controls";

export const metadata = { title: "Marks — Sampark" };
export const dynamic = "force-dynamic";

/**
 * How a marks round is watched, now that marks do not queue for review.
 *
 * A mark is written the moment the teacher submits it (see lib/submissions.ts),
 * which is right — the office has no way to check whether 18 out of 25 is the
 * correct mark, and a review nobody can actually perform is worse than none. But
 * it removed the one screen that said a round was happening at all, and the
 * office's real question was never "is this mark right". It is "who has not sent
 * theirs yet", and no screen answered that before this one.
 *
 * DELIBERATELY NOT THE REQUESTS BOARD. That board is one row per link, and a
 * round is sixteen to thirty-eight links whose only shared key is the period —
 * a teacher may hold three of them, for three classes, and have finished two.
 * Keyed on the period, the question is answerable; keyed on the link it is not.
 *
 * A server component with no client JavaScript: the period picker is links off
 * searchParams, the same shape /requests uses for its archived filter.
 */
export default async function MarksPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; by?: string }>;
}) {
  const params = await searchParams;
  const periods = await listMarksPeriods();

  // Newest by default: the round somebody is in the middle of is the one they
  // came here to look at.
  const selected =
    periods.find((row) => row.period === params.period)?.period ??
    periods[0]?.period ??
    null;

  const [marks, rosterSizes, asked] = await Promise.all([
    selected ? collectedMarks(selected) : Promise.resolve([]),
    countByClass(),
    selected ? askedFor(selected) : Promise.resolve([]),
  ]);
  const summary = selected ? summariseMarks(marks, rosterSizes, asked) : [];

  const teachers = new Set(summary.map((row) => row.teacher));
  const complete = summary.filter((row) => row.missing === 0 && row.onRoster > 0);
  const notStarted = summary.filter((row) => row.entered === 0);

  const columns: Column<SummaryRow>[] = [
    {
      key: "teacher",
      header: "Teacher",
      role: "primary",
      cell: (row) => row.teacher,
    },
    {
      key: "class",
      header: "Class",
      role: "secondary",
      cell: (row) => row.classLabel,
    },
    {
      key: "subject",
      header: "Subject",
      cell: (row) => row.subject,
      cellClassName: "text-[var(--color-ink-muted)]",
    },
    {
      key: "entered",
      header: "Entered",
      // Three states worth telling apart at a glance: done, under way, and not
      // started. The last one is the reason this board exists — a teacher who
      // has sent nothing is the whole question after a marks round.
      cell: (row) => (
        <span
          className={`font-mono text-xs ${
            row.onRoster > 0 && row.missing === 0
              ? "font-medium text-[var(--color-success)]"
              : row.entered === 0
                ? "rounded bg-[var(--color-correct-bg)] px-2 py-0.5 font-medium text-[var(--color-correct-fg)]"
                : ""
          }`}
        >
          {row.entered} / {row.onRoster}
        </span>
      ),
    },
    {
      key: "last",
      header: "Last entered",
      cell: (row) => (
        <span className="font-mono text-xs text-[var(--color-ink-muted)]">
          {row.lastEntered?.toISOString().slice(0, 10) ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Marks"
        subtitle={
          selected === null
            ? "No marks have been asked for yet."
            : `${summary.length} subject${summary.length === 1 ? "" : "s"} across ${teachers.size} teacher${teachers.size === 1 ? "" : "s"} — ${complete.length} complete, ${notStarted.length} not started. Marks go into the record as they are entered; there is nothing here to approve.`
        }
      />

      {periods.length === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-ink-muted)] md:p-6">
          <p className="font-medium text-[var(--color-ink)]">Nothing here yet.</p>
          <p className="mt-2">
            Send a marks request with a period on it — <code>2026-27/FA1</code> —
            and what the teachers enter will show up here as it arrives.
          </p>
          <Link href="/requests/bulk" className={`${btn({ tone: "quiet" })} mt-4`}>
            Send to many
          </Link>
        </section>
      ) : (
        <>
          {/* One round per chip. Links rather than a select: the list is short,
              and a select on a phone is a modal wheel for what is one tap. */}
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {periods.map((row) => (
              <Link
                key={row.period}
                href={`/marks?period=${encodeURIComponent(row.period)}`}
                aria-current={row.period === selected ? "page" : undefined}
                className={chip({ on: row.period === selected, pill: true })}
              >
                {row.period}
                <span className="font-mono text-xs opacity-60">{row.marks}</span>
              </Link>
            ))}
          </nav>

          <DataTable
            columns={columns}
            rows={summary}
            rowKey={(row) => `${row.teacher}|${row.classLabel}|${row.subject}`}
            empty="No marks entered for this period yet."
          />

          {summary.some((row) => row.teacher === UNATTRIBUTED) ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              &ldquo;{UNATTRIBUTED}&rdquo; is marks whose request has since been
              removed. The marks are safe and are in the export; only the record
              of who entered them is gone.
            </p>
          ) : null}

          <Card title="Export">
            <p className="text-sm text-[var(--color-ink-muted)]">
              One file for the whole round. A summary sheet showing who has
              entered what, then a sheet per teacher — or per class, if you want
              every subject side by side.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/api/export/marks.xlsx?period=${encodeURIComponent(selected!)}`}
                className={btn({ tone: "primary" })}
              >
                Download by teacher
              </a>
              <a
                href={`/api/export/marks.xlsx?period=${encodeURIComponent(selected!)}&by=class`}
                className={btn({ tone: "quiet" })}
              >
                By class
              </a>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
