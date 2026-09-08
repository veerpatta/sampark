import { isAnsweredFully } from "@/lib/answered";
import { compareClassLabels } from "@/lib/classes";
import type { BoardBatch, RequestBoardRow } from "@/lib/requests";
import { card } from "@/components/ui/controls";
import { ProgressBar } from "./ProgressBar";
import { TONE, toneOf } from "./progress-tone";

/**
 * How far a whole round has got.
 *
 * THE HOLE THIS FILLS. A round's own page could say how many messages had been
 * handed over and how many teachers were still being chased, and nothing at all
 * about what had come back — its header read "4 messages · 4 links · due 21
 * Aug". So a photo round with four hundred and ninety-three of five hundred and
 * thirty-one children done looked exactly like one nobody had started, and the
 * only way to learn otherwise was to open nineteen links or count down the
 * board. "How much is remaining" is the question the round page exists to
 * answer and was the one thing it could not.
 *
 * EVERY NUMBER COMES FROM groupBoardRows, WHICH IS THE BOARD'S OWN ARITHMETIC.
 * Nothing here recomputes "answered" — that definition lives in lib/answered.ts
 * and the last thing to form a second opinion about it was the request_progress
 * view, whose gravestone is still in drizzle/sql/grants.sql. The board's line
 * for this round and this header are the same fact at two sizes, and they
 * cannot drift because there is one function.
 *
 * A SERVER COMPONENT. It holds no state and handles no event; the copy buttons
 * are a client island of their own (RoundShare), which is the same split
 * WaitingList uses.
 */
export function RoundProgress({
  round,
  title,
  rows,
  today,
  share,
}: {
  /** The batch line, straight out of groupBoardRows. */
  round: BoardBatch;
  title: string;
  /** Every link in the round, for the group-by-group list. */
  rows: RequestBoardRow[];
  today: string;
  /** The copy block. Built on the server; see RoundShare. */
  share?: React.ReactNode;
}) {
  const remaining = Math.max(0, round.rosterSize - round.studentsAnswered);
  const groups = rows
    .slice()
    .sort((a, b) => compareClassLabels(a.audienceLabel, b.audienceLabel));

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <h2 className="text-title font-semibold">
        {round.studentsAnswered} of {round.rosterSize}{" "}
        {round.rosterSize === 1 ? "child" : "children"} answered for
      </h2>

      <ProgressBar
        value={round.studentsAnswered}
        max={round.rosterSize}
        tone={
          remaining === 0
            ? "bg-[var(--color-success)]"
            : "bg-[var(--color-warning)]"
        }
        label={`${title} — children answered for`}
        className="mt-2 h-2"
      />

      {/* The words, not only the bar. This gets read on a phone in a corridor
          between periods, and somebody who cannot separate two ambers still has
          to know whether the round is nearly done. */}
      <p className="mt-2 text-body">
        {remaining === 0 ? (
          <span className="font-medium text-[var(--color-success)]">
            Everything is in.
          </span>
        ) : (
          <>
            <span className="font-medium">{remaining} still to go</span>
            <span className="text-[var(--color-ink-muted)]">
              {" "}
              · {round.groupsAnswered} of {round.groups} groups complete
            </span>
          </>
        )}
      </p>

      {share}

      <div className="mt-4">
        <h3 className="text-label font-medium">Group by group</h3>
        <ul className="mt-2 divide-y divide-[var(--color-border)]">
          {groups.map((row) => {
            const done = isAnsweredFully(row);
            const tone =
              TONE[
                toneOf({
                  done,
                  sent: row.sentAt !== null,
                  opened: row.openedAt !== null,
                  overdue: row.dueDate < today && !done,
                  answered: row.studentsAnswered,
                })
              ];
            return (
              <li key={row.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {row.audienceLabel}
                  </span>
                  <span
                    className={`rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                  >
                    {tone.label}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {row.teacher}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar
                    value={row.studentsAnswered}
                    max={row.rosterSize}
                    tone={tone.bar}
                    label={`${row.audienceLabel} — ${title}`}
                    className="h-1.5 min-w-16 flex-1 sm:w-32 sm:flex-none"
                  />
                  <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                    {row.studentsAnswered} of {row.rosterSize}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
