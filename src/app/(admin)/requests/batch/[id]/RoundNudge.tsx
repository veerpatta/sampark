"use client";

import { remindedLabel, type TeacherReminder } from "@/lib/reminders";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { RemindButton } from "@/components/admin/RemindButton";
import { card } from "@/components/ui/controls";

/**
 * Who in this round has not finished, and one nudge each — worked as a queue.
 *
 * The send queue above hands the round over the first time. This is the second
 * conversation — a week later, when four of nineteen classes are still short and
 * somebody has to chase them. Without it that meant going back to the dashboard,
 * which mixes this round in with everything else the school is waiting on, and
 * picking the right teachers out by eye.
 *
 * IT IS A QUEUE NOW, NOT A LIST OF BUTTONS, and the reason is the same one
 * SendQueue was built for. The office chases from a corridor between periods,
 * gets interrupted, and comes back with no way to see who she already messaged —
 * so the same teacher gets nudged twice from two different phones while somebody
 * else gets missed. The tick is server state, so the queue survives being put
 * down and picked up on another device.
 *
 * A CHASE IS A DAY'S WORK. "Reminded" here means reminded TODAY — see
 * requests.reminded_at in the schema. Next week's chase opens fresh rather than
 * arriving fully ticked with nothing left to do.
 *
 * ONE MESSAGE PER TEACHER, covering everything she owes IN THIS ROUND. The
 * grouping and the message are the same ones the dashboard uses — see
 * lib/reminders.ts and buildRoundReminderMessage — so a teacher taking maths for
 * three classes gets one message here too, not three.
 *
 * A client component because the WhatsApp href is built from the message, and the
 * message is long enough — longer now that it names children — that building it
 * server-side would ship it twice: once as the href and once as the payload.
 */
export function RoundNudge({
  teachers,
  origin,
  batchId,
  today,
  apiEnabled = false,
}: {
  teachers: TeacherReminder[];
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
  batchId: string;
  /** The school's today, for "reminded 2 days ago". Also from the server. */
  today: string;
}) {
  if (teachers.length === 0) {
    return (
      <section className={`${card()} p-4 md:p-6`}>
        <h2 className="text-title font-semibold">Everyone has answered</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Every group in this round has been answered for in full. Nothing to
          chase.
        </p>
      </section>
    );
  }

  const done = teachers.filter((teacher) => teacher.remindedToday).length;
  const children = teachers.reduce(
    (sum, teacher) => sum + teacher.outstanding,
    0,
  );
  // The one to do next, so the queue reads as a queue rather than a table.
  const next = teachers.find((teacher) => !teacher.remindedToday);

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <h2 className="text-title font-semibold">
        Still waiting on {teachers.length}{" "}
        {teachers.length === 1 ? "teacher" : "teachers"}
      </h2>
      {/* Fixed green, like SendQueue's: this counts chases that have actually
          gone out, and there is no state it could disagree with. */}
      <ProgressBar
        value={done}
        max={teachers.length}
        tone="bg-[var(--color-success)]"
        label="Teachers chased today in this round"
        className="mt-2 h-1.5"
      />
      <p className="mt-1 font-mono text-meta text-[var(--color-ink-muted)]">
        {done} of {teachers.length} reminded today · {children}{" "}
        {children === 1 ? "child" : "children"} to go
      </p>
      <p className="mt-2 text-label text-[var(--color-ink-muted)]">
        One message each, naming the children she still has to fill in.
        {apiEnabled
          ? " Remind sends it through WhatsApp and ticks itself."
          : " Tap to open WhatsApp with it ready — come back and the next one is waiting."}
      </p>

      <ul className="mt-3 space-y-2">
        {teachers.map((teacher) => {
          const isNext = next?.key === teacher.key;
          const label = remindedLabel({ ...teacher, today });
          return (
            <li
              key={teacher.key}
              className={`rounded-[var(--radius-card)] border p-3 ${
                isNext
                  ? "border-[var(--color-brand-600)]"
                  : "border-[var(--color-border)]"
              } ${teacher.remindedToday ? "opacity-70" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-name font-medium">{teacher.teacherName}</p>
                  <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
                    {teacher.forms.map((form) => form.audienceLabel).join(", ")}
                    {teacher.outstanding > 0
                      ? ` · ${teacher.outstanding} to go`
                      : ""}
                    {/* A nudge going to a covering teacher's phone rather than
                        to hers must never be silent about it. */}
                    {teacher.overridden ? (
                      <span className="ml-1 font-mono">→ {teacher.phone}</span>
                    ) : null}
                  </p>

                  {/* On its own line, not appended to the groups above: at 360px
                      that line is already truncating. */}
                  {label ? (
                    <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
                      {label}
                    </p>
                  ) : null}

                  {/* The first few names she owes, so the office can see what the
                      message will actually say before sending it. */}
                  <Names teacher={teacher} />
                </div>

                <RemindButton
                  teacher={teacher}
                  origin={origin}
                  batchId={batchId}
                  apiEnabled={apiEnabled}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** How many names to show on the card. The message itself carries far more. */
const PREVIEW = 3;

/**
 * A glance at who the message will name.
 *
 * Not the whole list — that is what the message is for, and what the request
 * page's "Still waiting" is for. This exists so the office can tell at a glance
 * that the nudge is about four specific children rather than a whole class, which
 * is the difference between "she has not started" and "she nearly finished".
 */
function Names({ teacher }: { teacher: TeacherReminder }) {
  const named = teacher.forms
    .flatMap((form) => form.pending ?? [])
    .slice(0, PREVIEW);
  if (named.length === 0) return null;

  const rest = teacher.outstanding - named.length;
  return (
    <p className="mt-1 text-meta text-[var(--color-ink-faint)]">
      {named
        .map((student) =>
          student.rollNo === null
            ? student.name
            : `${student.rollNo}. ${student.name}`,
        )
        .join(", ")}
      {rest > 0 ? ` +${rest}` : ""}
    </p>
  );
}
