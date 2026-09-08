"use client";

import { useOptimistic, useTransition } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { TeacherReminder } from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { isoDay } from "@/lib/today";
import { card } from "@/components/ui/controls";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { TONE, toneOf } from "@/components/admin/progress-tone";
import { recordReminded } from "./actions";

/**
 * Who in this round has not finished, worked through one teacher at a time.
 *
 * This replaces RoundNudge, which listed the same teachers and put a Remind
 * button beside each. That was right about the message and silent about
 * everything else: it could not say who had already been chased, so an office
 * interrupted halfway started again from the top and nudged the same four
 * people twice.
 *
 * THERE IS NO BULK SEND HERE AND THERE CANNOT BE. Delivery is a wa.me link, so
 * chasing nine teachers is nine handovers however it is dressed up — the same
 * fact SendQueue states above it. What this can do is make the nine cost no
 * decisions: one card each, carrying everything she owes, in an order, with the
 * next one highlighted. The genuinely one-tap reminder is the staff-group
 * message on the progress card above, and it is one tap because it goes to a
 * room rather than to nine people.
 *
 * "CHASED" IS SCOPED TO TODAY, WHICH IS WHAT MAKES A ONE-COLUMN TICK HONEST.
 * There is no untick and no reset button: reminded_at is a timestamp, the queue
 * asks whether it falls on the school's calendar day (Asia/Kolkata, never the
 * machine's — see lib/today.ts), and tomorrow the queue is simply full again. A
 * boolean would have needed somebody to remember to clear it, and a reset
 * nobody presses is a queue that claims everyone has been chased for ever.
 *
 * A client component because the wa.me href is built from the message, and the
 * message is long enough that building it on the server would ship it twice.
 */
export function ChaseQueue({
  batchId,
  teachers,
  origin,
  today,
}: {
  batchId: string;
  teachers: TeacherReminder[];
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
  /** The school's calendar day, resolved on the server for the same reason. */
  today: string;
}) {
  const [pending, startTransition] = useTransition();

  const [rows, markOptimistic] = useOptimistic(
    teachers,
    (current: TeacherReminder[], key: string) =>
      current.map((teacher) =>
        teacher.key === key
          ? {
              ...teacher,
              remindedAt: new Date(),
              remindCount: teacher.remindCount + 1,
            }
          : teacher,
      ),
  );

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

  const chasedToday = (teacher: TeacherReminder) =>
    teacher.remindedAt !== null &&
    isoDay(new Date(teacher.remindedAt)) === today;

  const done = rows.filter(chasedToday).length;
  // The one to do next, so the list reads as a queue rather than as a table.
  const next = rows.find((teacher) => !chasedToday(teacher));

  function remindHref(teacher: TeacherReminder) {
    return buildWhatsAppLink(
      teacher.phone,
      buildRoundReminderMessage({
        teacherName: teacher.teacherName,
        teacherPageUrl: teacher.linkToken
          ? teacherPageUrl(origin, teacher.linkToken)
          : undefined,
        items: teacher.forms.map((form) => ({
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
  }

  function chase(teacher: TeacherReminder) {
    startTransition(async () => {
      markOptimistic(teacher.key);
      await recordReminded(
        teacher.forms.map((form) => form.requestId),
        batchId,
      );
    });
  }

  return (
    <section className={`${card()} p-4 md:p-6`}>
      {/* The wording is load bearing: scripts/smoke-ui.ts asserts on "Still
          waiting" to know the round can be chased at all. */}
      <h2 className="text-title font-semibold">
        Still waiting on {rows.length}{" "}
        {rows.length === 1 ? "teacher" : "teachers"}
      </h2>
      <ProgressBar
        value={done}
        max={rows.length}
        tone="bg-[var(--color-success)]"
        label="Teachers chased today"
        className="mt-2 h-1.5"
      />
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        {done} of {rows.length} chased today. One message each, covering
        everything that teacher still owes in this round — tap to open WhatsApp
        with it ready, come back and the next one is waiting.
      </p>

      <ul className="mt-3 space-y-2">
        {rows.map((teacher) => {
          const isNext = next?.key === teacher.key;
          const chased = chasedToday(teacher);
          return (
            <li
              key={teacher.key}
              className={`rounded-[var(--radius-card)] border p-3 ${
                isNext
                  ? "border-[var(--color-brand-600)]"
                  : "border-[var(--color-border)]"
              } ${chased ? "opacity-70" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{teacher.teacherName}</span>
                    {teacher.outstanding > 0 ? (
                      <span className="text-sm text-[var(--color-ink-muted)]">
                        {teacher.outstanding} to go
                      </span>
                    ) : null}
                    {/* A nudge going to a covering teacher's phone rather than
                        to hers must never be silent about it. */}
                    {teacher.overridden ? (
                      <span className="rounded-[var(--radius-chip)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                        to {teacher.phone}
                      </span>
                    ) : null}
                    {/* Not a badge of honour. A teacher on her third reminder
                        needs a phone call, and the count is the only thing on
                        this screen that can say so. */}
                    {teacher.remindCount > 0 ? (
                      <span className="rounded-[var(--radius-chip)] bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
                        chased {teacher.remindCount}&times;
                      </span>
                    ) : null}
                  </div>

                  <ul className="mt-1 space-y-0.5">
                    {teacher.forms.map((form) => {
                      const tone =
                        TONE[
                          toneOf({
                            done: false,
                            sent: form.sent,
                            opened: form.opened,
                            overdue: form.overdue,
                            answered: form.answered,
                          })
                        ];
                      return (
                        <li
                          key={form.requestId}
                          className="flex flex-wrap items-center gap-x-2 text-sm"
                        >
                          <span>{form.audienceLabel}</span>
                          <span
                            className={`rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                          >
                            {tone.label}
                          </span>
                          <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                            {form.answered} of {form.rosterSize}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {chased ? (
                  <span className="flex min-h-[var(--tap-min)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-confirm-bg)] px-3 text-sm font-semibold text-[var(--color-confirm-fg)]">
                    <CheckCircle aria-hidden size={16} weight="fill" />
                    Chased
                  </span>
                ) : (
                  <a
                    href={remindHref(teacher)}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() => chase(teacher)}
                    aria-disabled={pending}
                    className={`flex min-h-[var(--tap-min)] shrink-0 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] ${
                      isNext
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--color-brand-600)]"
                    }`}
                  >
                    Remind
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {done === rows.length ? (
        <p className="mt-3 rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
          Everyone still outstanding has been chased today. The queue fills up
          again tomorrow if they have not answered.
        </p>
      ) : null}
    </section>
  );
}
