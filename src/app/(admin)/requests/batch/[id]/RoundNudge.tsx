"use client";

import type { TeacherReminder } from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn, card } from "@/components/ui/controls";

/**
 * Who in this round has not finished, and one nudge each.
 *
 * The send queue above hands the round over the first time. This is the second
 * conversation — a week later, when four of nineteen classes are still short
 * and somebody has to chase them. Without it that meant going back to the
 * dashboard, which mixes this round in with everything else the school is
 * waiting on, and picking the right teachers out by eye.
 *
 * ONE MESSAGE PER TEACHER, covering everything she owes IN THIS ROUND. The
 * grouping and the message are the same ones the dashboard uses — see
 * lib/reminders.ts and buildRoundReminderMessage — so a teacher taking maths
 * for three classes gets one message here too, not three.
 *
 * A client component only because the WhatsApp href is built from the message,
 * and the message is long enough that building it server-side would ship it
 * twice: once as the href and once as the payload.
 */
export function RoundNudge({
  teachers,
  origin,
}: {
  teachers: TeacherReminder[];
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
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

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <h2 className="text-title font-semibold">
        Still waiting on {teachers.length}{" "}
        {teachers.length === 1 ? "teacher" : "teachers"}
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        One message each, covering everything she still owes in this round.
      </p>

      <ul className="mt-3 divide-y divide-[var(--color-border)]">
        {teachers.map((teacher) => (
          <li key={teacher.key} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{teacher.teacherName}</span>
              <span className="ml-2 text-sm text-[var(--color-ink-muted)]">
                {teacher.forms.map((form) => form.audienceLabel).join(", ")}
                {teacher.outstanding > 0 ? ` · ${teacher.outstanding} to go` : ""}
              </span>
              {/* A nudge going to a covering teacher's phone rather than to
                  hers must never be silent about it. */}
              {teacher.overridden ? (
                <span className="ml-2 rounded-[var(--radius-chip)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                  to {teacher.phone}
                </span>
              ) : null}
            </div>
            <a
              href={remindHref(teacher)}
              target="_blank"
              rel="noreferrer noopener"
              className={`${btn()} shrink-0 px-3 text-[13px]`}
            >
              Remind
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
