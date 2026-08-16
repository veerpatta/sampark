import Link from "next/link";
import type { Bucket, ProgressForm, TeacherProgress } from "@/lib/progress";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { toReminder } from "@/lib/reminders";
import { btn } from "@/components/ui/controls";
import { ProgressBar } from "./ProgressBar";

/**
 * How far each teacher has got, and one way to chase her.
 *
 * ONE COMPONENT, TWO SCREENS. The dashboard and /requests both have to answer
 * "who is behind", and they used to answer it with two different renderings of
 * two different groupings — the dashboard's dropped finished teachers, the
 * requests board had no per-teacher view at all. Two implementations of one
 * question drift, and the drift is invisible until somebody compares two tabs.
 *
 * A SERVER COMPONENT. The panel this replaces was "use client" but used no
 * hook, no handler and no browser API: every button in it is already an
 * `<a href>`, because a real link is never popup-blocked. `origin` arrives as a
 * prop and is never read off `window` — see lib/request-origin.ts for the bug
 * that caused on this exact button.
 *
 * ONE REMIND PER PERSON, NEVER PER LINK. lib/reminders.ts exists because a
 * button on every row sent a teacher who takes maths for three classes three
 * near-identical messages inside a few seconds. This screen shows MORE rows per
 * teacher than that one did, so re-introducing a per-row button here would be
 * the same bug, larger.
 */

type Tone = "unsent" | "waiting" | "progress" | "overdue" | "done";

/**
 * Every state carries a WORD. Colour is never the sole carrier — the office
 * reads this on a phone in a corridor, and somebody who cannot separate the
 * amber from the red still has to know who to chase.
 */
const TONE: Record<Tone, { label: string; pill: string; bar: string }> = {
  unsent: {
    label: "not sent",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
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
function toneOf(form: ProgressForm): Tone {
  if (form.done) return "done";
  if (!form.sent) return "unsent";
  if (form.overdue) return "overdue";
  return form.answered > 0 ? "progress" : "waiting";
}

export function TeacherProgressList({
  teachers,
  origin,
  limit,
  more,
  empty = "Everything open has been answered for.",
}: {
  teachers: TeacherProgress[];
  origin: string;
  /** The dashboard shows the worst few; /requests shows everyone. */
  limit?: number;
  /** Rendered under a truncated list — "see all 14". */
  more?: React.ReactNode;
  empty?: React.ReactNode;
}) {
  if (teachers.length === 0) {
    return (
      <p className="text-sm text-[var(--color-confirm-fg)]">{empty}</p>
    );
  }

  const shown = limit === undefined ? teachers : teachers.slice(0, limit);

  return (
    <>
      <ul className="divide-y divide-[var(--color-border)]">
        {shown.map((teacher) => (
          <li key={teacher.key} className="py-3 first:pt-0">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{teacher.teacherName}</span>
                  <span className="text-sm text-[var(--color-ink-muted)]">
                    {teacher.forms.length === 1
                      ? "1 list"
                      : `${teacher.forms.length} lists`}
                  </span>
                  {/* Said out loud, because a nudge going to a covering
                      teacher's phone rather than to hers is exactly the thing
                      the office must not discover afterwards. */}
                  {teacher.overridden ? (
                    <span className="rounded-[var(--radius-chip)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                      to {teacher.phone}
                    </span>
                  ) : null}
                </div>

                {/* THE TWO COUNTS GO ON THEIR OWN LINE, not beside the name.
                    design-qa.md removed a 4px rail because it "cost 12px on a
                    360px screen where the teacher's name was truncating"; two
                    counts sharing that line would cost far more. */}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Count label="marks" bucket={teacher.marks} />
                  <Count label="details" bucket={teacher.details} />
                  <Count label="marks + details" bucket={teacher.mixed} />
                  {teacher.changesPending > 0 ? (
                    <span className="rounded bg-[var(--color-correct-bg)] px-1.5 py-0.5 font-mono text-xs font-medium text-[var(--color-correct-fg)]">
                      {teacher.changesPending} to review
                    </span>
                  ) : null}
                </div>
              </div>

              <RemindButton teacher={teacher} origin={origin} />
            </div>

            <ul className="mt-2 space-y-1.5">
              {teacher.forms.map((form) => {
                const tone = TONE[toneOf(form)];
                return (
                  <li key={form.requestId}>
                    <Link
                      href={`/requests/${form.requestId}`}
                      className="block py-0.5 hover:text-[var(--color-brand-600)]"
                    >
                      <span className="text-sm">{form.audienceLabel}</span>
                      <span
                        className={`ml-2 rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                      >
                        {tone.label}
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <ProgressBar
                          value={form.answered}
                          max={form.rosterSize}
                          tone={tone.bar}
                          label={`${form.audienceLabel} — ${form.title}`}
                          className="h-1.5 min-w-16 flex-1 sm:w-24 sm:flex-none"
                        />
                        <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                          {form.answered} of {form.rosterSize}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {more !== undefined && shown.length < teachers.length ? (
        <div className="mt-3">{more}</div>
      ) : null}
    </>
  );
}

/**
 * One kind of work, or nothing at all.
 *
 * A teacher holding no marks rounds gets no marks count rather than a "0 / 0" —
 * a zero against a zero is not a fact about her, and on a phone it is a third
 * of the line spent saying nothing.
 */
function Count({ label, bucket }: { label: string; bucket: Bucket }) {
  if (bucket.links === 0) return null;

  const done = bucket.outstanding === 0 && bucket.students > 0;
  return (
    <span className="flex items-baseline gap-1 text-xs">
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <span
        className={`font-mono ${
          done ? "font-medium text-[var(--color-success)]" : ""
        }`}
      >
        {bucket.answered}/{bucket.students}
      </span>
    </span>
  );
}

/**
 * The nudge, addressed to her, carrying everything she still owes.
 *
 * A real link rather than a handler, so the tap goes straight to that teacher's
 * WhatsApp chat. Nothing when she has nothing outstanding — toReminder returns
 * null, and a Remind button on a finished teacher is a message with no content.
 */
function RemindButton({
  teacher,
  origin,
}: {
  teacher: TeacherProgress;
  origin: string;
}) {
  const reminder = toReminder(teacher);
  if (!reminder) return null;

  const href = buildWhatsAppLink(
    reminder.phone,
    buildRoundReminderMessage({
      teacherName: reminder.teacherName,
      // Her durable page when she has one: it already carries every form, so
      // sending it instead of N per-request links is the same collapse this
      // component does on screen.
      teacherPageUrl: reminder.linkToken
        ? teacherPageUrl(origin, reminder.linkToken)
        : undefined,
      items: reminder.forms.map((form) => ({
        audience: {
          kind: form.audienceKind,
          label: form.audienceLabel,
          fieldKeys: form.fieldKeys,
        },
        title: form.title,
        dueDate: form.dueDate,
        url: `${origin}/r/${form.token}`,
        answered: form.answered,
        rosterSize: form.rosterSize,
      })),
    }),
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`${btn()} shrink-0 px-3 text-[13px]`}
    >
      Remind
    </a>
  );
}
