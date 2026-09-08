import Link from "next/link";
import type { Bucket, ProgressForm, TeacherProgress } from "@/lib/progress";
import { remindedLabel, toReminder } from "@/lib/reminders";
import { ProgressBar } from "./ProgressBar";
import { TONE, toneOf } from "./progress-tone";
import { RemindAll } from "./RemindAll";
import { RemindButton } from "./RemindButton";
import { FOCUS } from "@/components/ui/controls";

/**
 * How far each teacher has got, and one way to chase her.
 *
 * ONE COMPONENT, TWO SCREENS. The dashboard and /requests both have to answer
 * "who is behind", and they used to answer it with two different renderings of
 * two different groupings — the dashboard's dropped finished teachers, the
 * requests board had no per-teacher view at all. Two implementations of one
 * question drift, and the drift is invisible until somebody compares two tabs.
 *
 * STILL A SERVER COMPONENT, with the client boundary drawn around one button.
 * The panel this replaces was "use client" but used no hook, no handler and no
 * browser API. That stayed true until the chase needed a tick, which needs a
 * transition — so the Remind button moved to components/admin/RemindButton.tsx
 * and everything else here is unchanged. Its href is still a real `<a>`, because
 * a real link is never popup-blocked, and the tick rides on `onClick`.
 *
 * `origin` and `today` arrive as props and are never read off `window` or the
 * browser clock — see lib/request-origin.ts for the bug that caused on this exact
 * button, and lib/today.ts for the five-hour window where a date computed in the
 * browser is the wrong day.
 *
 * ONE REMIND PER PERSON, NEVER PER LINK. lib/reminders.ts exists because a
 * button on every row sent a teacher who takes maths for three classes three
 * near-identical messages inside a few seconds. This screen shows MORE rows per
 * teacher than that one did, so re-introducing a per-row button here would be
 * the same bug, larger.
 */

export function TeacherProgressList({
  teachers,
  origin,
  today,
  limit,
  more,
  empty = "Everything open has been answered for.",
  apiEnabled = false,
  mobileDetails = "expanded",
}: {
  teachers: TeacherProgress[];
  origin: string;
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
  /**
   * The school's today, for "reminded 2 days ago".
   *
   * From the server for the same reason `origin` is: a date computed in the
   * browser is the visitor's calendar day, and lib/today.ts documents the
   * five-and-a-half-hour window in which that is a different day from the
   * school's.
   */
  today: string;
  /** The dashboard shows the worst few; /requests shows everyone. */
  limit?: number;
  /** Rendered under a truncated list — "see all 14". */
  more?: React.ReactNode;
  empty?: React.ReactNode;
  /** Collapse a teacher's individual lists behind their aggregate on phones. */
  mobileDetails?: "collapsed" | "expanded";
}) {
  if (teachers.length === 0) {
    return (
      <p className="text-sm text-[var(--color-confirm-fg)]">{empty}</p>
    );
  }

  const shown = limit === undefined ? teachers : teachers.slice(0, limit);

  /*
   * The chase list, collapsed to one entry per person.
   *
   * Built from `teachers` and NOT from `shown`: the dashboard renders the worst
   * five, and a button reading "Remind all 5" on a screen where fourteen are
   * behind would be quietly wrong about the thing it is counting. toReminder
   * drops anyone with nothing outstanding, which is the same filter the
   * per-row button already applies.
   */
  const chase = teachers
    .map(toReminder)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <>
      {/* Stands itself down below two outstanding teachers. */}
      <RemindAll teachers={chase} origin={origin} apiEnabled={apiEnabled} />

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

              <Remind
                teacher={teacher}
                origin={origin}
                today={today}
                apiEnabled={apiEnabled}
              />
            </div>

            {mobileDetails === "collapsed" && teacher.forms.length > 1 ? (
              <details className="mt-1 md:hidden">
                <summary className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center text-sm font-medium text-[var(--color-brand-600)] ${FOCUS}`}>
                  Show {teacher.forms.length} lists
                </summary>
                <ProgressForms forms={teacher.forms} className="pb-1" />
              </details>
            ) : (
              <div className="md:hidden">
                <ProgressForms forms={teacher.forms} />
              </div>
            )}

            <div className="hidden md:block">
              <ProgressForms forms={teacher.forms} />
            </div>
          </li>
        ))}
      </ul>

      {more !== undefined && shown.length < teachers.length ? (
        <div className="mt-3">{more}</div>
      ) : null}
    </>
  );
}

function ProgressForms({
  forms,
  className = "",
}: {
  forms: ProgressForm[];
  className?: string;
}) {
  return (
    <ul className={`mt-2 space-y-1.5 ${className}`}>
      {forms.map((form) => {
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
 * Her nudge, or nothing at all.
 *
 * Nothing when she has nothing outstanding — toReminder returns null, and a
 * Remind button on a finished teacher is a message with no content.
 *
 * The button itself moved to components/admin/RemindButton.tsx, which is a client
 * island: the tick that records the chase needs a transition, and this list is a
 * server component that should stay one. See that file's header.
 */
function Remind({
  teacher,
  origin,
  today,
  apiEnabled,
}: {
  teacher: TeacherProgress;
  origin: string;
  today: string;
  apiEnabled: boolean;
}) {
  const reminder = toReminder(teacher);
  if (!reminder) return null;

  const label = remindedLabel({ ...reminder, today });

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <RemindButton teacher={reminder} origin={origin} apiEnabled={apiEnabled} />
      {/* On its own line under the button, never beside her name — see the note
          on the two counts above. */}
      {label ? (
        <span className="text-right text-xs text-[var(--color-ink-muted)]">
          {label}
        </span>
      ) : null}
    </div>
  );
}
