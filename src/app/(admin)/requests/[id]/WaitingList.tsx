"use client";

import type { PendingStudent } from "@/lib/pending";
import { useCopy } from "@/components/ui/useCopy";
import { FOCUS } from "@/components/ui/controls";

/**
 * The children this link is still waiting on, by name.
 *
 * This used to be a bare `<ul>` inside a definition-list row, which is fine for
 * the four stragglers it was designed around and forty-six lines of unbroken
 * text on a 390px screen when a class has not started. So the list past a dozen
 * folds away behind its own count.
 *
 * A `<details>`, NOT A MODAL. The repo has none — see AddQuestion.tsx for the
 * reasoning — and this is progressive disclosure of something already on the
 * page, which is exactly what `<details>` is for. `min-h-[var(--tap-min)]` and
 * `list-none` on the summary, as FilterBar.tsx does.
 *
 * A CLIENT COMPONENT ONLY FOR THE COPY BUTTON. The list itself is server-rendered
 * data handed down as a prop; nothing here fetches or decides anything.
 */

/**
 * How many names stand in the open before the rest folds away.
 *
 * A dozen is about what a phone shows without the page becoming a scroll to get
 * past — and a class with only a handful left, which is the common case late in a
 * round, never folds at all.
 */
const SHOWN = 12;

export function WaitingList({
  waiting,
  rosterSize,
  /** True when the roster spans registers, so each name needs its class. */
  spansClasses,
  /** Nobody has answered yet — the count reads as a warning rather than progress. */
  notStarted,
}: {
  waiting: PendingStudent[];
  rosterSize: number;
  spansClasses: boolean;
  notStarted: boolean;
}) {
  const { copy, copied } = useCopy();

  if (waiting.length === 0) {
    return (
      <span className="text-[var(--color-success)]">
        none — every student answered
      </span>
    );
  }

  const head = waiting.slice(0, SHOWN);
  const rest = waiting.slice(SHOWN);

  return (
    <>
      <span className={notStarted ? "text-[var(--color-warning)]" : ""}>
        {waiting.length} of {rosterSize}
      </span>

      <ul className="mt-1 text-xs font-normal text-[var(--color-ink-muted)]">
        {head.map((student) => (
          <Name key={student.studentId} student={student} spans={spansClasses} />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="mt-1">
          <summary
            className={`flex min-h-[var(--tap-min)] list-none items-center text-xs text-[var(--color-brand-600)] hover:underline ${FOCUS}`}
          >
            and {rest.length} more
          </summary>
          <ul className="text-xs font-normal text-[var(--color-ink-muted)]">
            {rest.map((student) => (
              <Name
                key={student.studentId}
                student={student}
                spans={spansClasses}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {/* The whole list, however long — the reminder message caps out well
          before a house link does, and this is what covers the difference. */}
      <button
        type="button"
        onClick={() => void copy(asText(waiting, spansClasses))}
        className={`mt-1 inline-flex min-h-[var(--tap-min)] items-center text-xs font-normal text-[var(--color-brand-600)] hover:underline ${FOCUS}`}
      >
        {copied ? "Copied" : `Copy all ${waiting.length}`}
      </button>
    </>
  );
}

function Name({
  student,
  spans,
}: {
  student: PendingStudent;
  spans: boolean;
}) {
  return (
    <li>
      {student.rollNo === null ? "" : `${student.rollNo}. `}
      {student.name}
      {spans && student.classLabel ? (
        <span className="text-[var(--color-ink-faint)]"> ({student.classLabel})</span>
      ) : null}
    </li>
  );
}

/** One name per line, the way it would be pasted into a message or a register. */
function asText(waiting: PendingStudent[], spans: boolean): string {
  return waiting
    .map((student) => {
      const roll = student.rollNo === null ? "" : `${student.rollNo}. `;
      const where = spans && student.classLabel ? ` (${student.classLabel})` : "";
      return `${roll}${student.name}${where}`;
    })
    .join("\n");
}
