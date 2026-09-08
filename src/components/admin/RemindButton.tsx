"use client";

import { useTransition } from "react";
import type { TeacherProgress } from "@/lib/progress";
import { toReminder } from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn } from "@/components/ui/controls";
import { remindFromBoard } from "@/app/(admin)/requests/remind-actions";

/**
 * The nudge, addressed to her, carrying everything she still owes.
 *
 * ONE PER PERSON, NEVER PER LINK. lib/reminders.ts exists because a button on
 * every row sent a teacher who takes maths for three classes three
 * near-identical messages inside a few seconds — from her end that is not three
 * reminders, it is one person spamming her. `toReminder` returns null for a
 * teacher with nothing outstanding, which is how she leaves the list rather
 * than appearing on it with an empty message.
 *
 * A REAL LINK, NOT A HANDLER THAT OPENS ONE. A browser never blocks a genuine
 * link, and this page has to stay alive afterwards to record the chase — the
 * same reasoning as SendQueue's hand-over, set out at length in
 * components/ui/share.ts.
 *
 * IT IS A CLIENT COMPONENT ONLY BECAUSE IT RECORDS THE CHASE. It used to be a
 * plain anchor inside TeacherProgressList, which is a server component and
 * stays one; splitting the button out is what lets requests.remind_count be
 * true no matter which of the three screens the office chased her from.
 */
export function RemindButton({
  teacher,
  origin,
}: {
  teacher: TeacherProgress;
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
}) {
  const [pending, startTransition] = useTransition();

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
      aria-disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await remindFromBoard(reminder.forms.map((form) => form.requestId));
        })
      }
      className={`${btn()} shrink-0 px-3 text-[13px]`}
    >
      Remind
    </a>
  );
}
