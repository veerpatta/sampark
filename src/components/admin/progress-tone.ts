/**
 * What state one group's work is in, as a word and a colour — in that order.
 *
 * EVERY STATE CARRIES A WORD. Colour is never the sole carrier: this is read on
 * a phone in a corridor between periods, and somebody who cannot separate the
 * amber from the red still has to know which teacher to chase. That rule was
 * written for TeacherProgressList and it is why this table now lives on its
 * own — the round page shows the same six states about the same links, and a
 * second colour policy is exactly how the three separate ones that ProgressBar's
 * header complains about came to exist.
 */

export type Tone =
  | "unsent"
  | "unopened"
  | "waiting"
  | "progress"
  | "overdue"
  | "done";

export const TONE: Record<Tone, { label: string; pill: string; bar: string }> = {
  unsent: {
    label: "not sent",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    bar: "bg-[var(--color-border)]",
  },
  unopened: {
    // Amber text on the muted surface rather than on an amber one: "in
    // progress" already owns the amber fill, and these two must not read as
    // the same state at a glance. There is no --color-warning-bg token and
    // inventing one is a design decision for tokens.css, not for this file.
    label: "not opened",
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
 * The order the checks run in is the whole content of this function.
 *
 * "Not sent" outranks everything except being finished: a link the office never
 * handed over is not a teacher who has not started, and saying "not started"
 * about it puts the blame on the wrong person. Done still wins over it, because
 * an answered link that was somehow never ticked is finished either way.
 *
 * "NOT OPENED" SITS BETWEEN THEM, AND IT IS A DIFFERENT PROBLEM FROM THE ONE
 * BELOW IT. A link that was sent and never opened means a wrong number, or a
 * message that scrolled away under forty others — the fix is a phone call, not
 * a fourth reminder. Until requests.opened_at was read, both that and a teacher
 * who opened the list and did not fill it in rendered as "not started", and
 * only one of those two is hers.
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
  if (!form.opened) return "unopened";
  return form.answered > 0 ? "progress" : "waiting";
}
