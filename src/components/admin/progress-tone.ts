/**
 * What state one link's work is in, as a word and a colour — in that order.
 *
 * EVERY STATE CARRIES A WORD. Colour is never the sole carrier: these boards
 * get read on a phone in a corridor between periods, and somebody who cannot
 * separate the amber from the red still has to know who to chase.
 *
 * ITS OWN FILE BECAUSE TWO SCREENS ANSWER THE SAME QUESTION. The per-teacher
 * list and the round's group-by-group breakdown describe the same six states
 * about the same links, and TeacherProgressList's own header is about what
 * happens when one question gets two implementations: they drift, and the drift
 * is invisible until somebody compares two tabs.
 */

export type Tone =
  | "unsent"
  | "unopened"
  | "waiting"
  | "progress"
  | "overdue"
  | "done";

/**
 * Every state carries a WORD. Colour is never the sole carrier — the office
 * reads this on a phone in a corridor, and somebody who cannot separate the
 * amber from the red still has to know who to chase.
 */
export const TONE: Record<Tone, { label: string; pill: string; bar: string }> = {
  unsent: {
    label: "not sent",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    bar: "bg-[var(--color-border)]",
  },
  unopened: {
    label: "not opened",
    // Amber TEXT on the muted surface, not an amber fill: "in progress" already
    // owns the amber background and these two must not read as one state at a
    // glance. There is no --color-warning-bg token, and inventing one is a
    // decision for tokens.css rather than for this file.
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-warning-fg)]",
    bar: "bg-[var(--color-border)]",
  },
  waiting: {
    label: "not started",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    bar: "bg-[var(--color-border)]",
  },
  progress: {
    label: "in progress",
    pill: "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]",
    bar: "bg-[var(--color-warning)]",
  },
  overdue: {
    label: "overdue",
    pill: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
    bar: "bg-[var(--color-danger)]",
  },
  done: {
    label: "complete",
    pill: "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]",
    bar: "bg-[var(--color-success)]",
  },
};

/**
 * "Not sent" outranks everything except being finished.
 *
 * A link the office never handed over is not a teacher who has not started, and
 * saying "not started" about it puts the blame on the wrong person. Done still
 * wins over it, because an answered link that was somehow never marked sent is
 * finished either way and there is nothing to do about it.
 */
export function toneOf(form: {
  done: boolean;
  sent: boolean;
  opened: boolean;
  overdue: boolean;
  answered: number;
}): Tone {
  if (form.done) return "done";
  if (!form.sent) return "unsent";
  if (form.overdue) return "overdue";
  // BETWEEN "not sent" AND "not started", and it is a different problem from
  // either. The office never handed the first one over; the third is a teacher
  // who has the list and has not started it. This one she was sent and never
  // opened — a wrong number, or a message that scrolled away — and the fix is
  // a phone call, not another message she will not see either.
  if (!form.opened) return "unopened";
  return form.answered > 0 ? "progress" : "waiting";
}
