"use client";

import { useOptimistic, useTransition } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { TeacherReminder } from "@/lib/reminders";
import { isoDay } from "@/lib/today";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn } from "@/components/ui/controls";
import { setTeacherReminded } from "@/app/(admin)/requests/reminder-actions";

/**
 * The nudge, addressed to her, carrying everything she still owes — and the tick
 * that records it.
 *
 * ONE MESSAGE PER PERSON, NEVER PER LINK. lib/reminders.ts exists because a
 * button on every row sent a teacher who takes maths for three classes three
 * near-identical messages inside four seconds. Everything here takes a
 * TeacherReminder, which is already collapsed to one entry per (teacher, number).
 *
 * A REAL LINK WITH THE TICK ON `onClick`, and that split is deliberate. A browser
 * never blocks a genuine `<a target="_blank">`, and the page stays alive to record
 * the tap — which is what makes the tick possible at all. Making the button a
 * handler that opened the window would trade a guaranteed delivery for a
 * pop-up-blocker prompt. Same shape as SendQueue's Send button.
 *
 * WHY THIS IS A CLIENT COMPONENT when TeacherProgressList is not. That file's
 * header says every button in it is already an `<a href>` and it therefore needs
 * no client boundary — true until the tick arrived, which needs a transition and
 * an optimistic flip. So the boundary is drawn here, around the one piece that
 * genuinely needs it, rather than turning the whole list client-side.
 *
 * The message is built at render for the same reason RoundNudge builds its own:
 * it is long enough — longer now that it names children — that handing it down
 * from the server would ship it twice, once as the href and once as the payload.
 */
export function RemindButton({
  teacher,
  origin,
  batchId,
  className = "",
}: {
  teacher: TeacherReminder;
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
  /** Set when the chase started on one round's page, so it revalidates too. */
  batchId?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [reminded, flip] = useOptimistic(
    teacher.remindedToday,
    (_current: boolean, next: boolean) => next,
  );

  const href = buildWhatsAppLink(
    teacher.phone,
    buildRoundReminderMessage({
      teacherName: teacher.teacherName,
      // Her durable page when she has one: it already carries every form, so
      // sending it instead of N per-request links is the same collapse the list
      // does on screen.
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
        // Passed straight through, all three states intact. pendingForBoard has
        // already decided which rows are worth naming and marked the rest `null`;
        // re-deriving the ceiling here would be a second opinion about what she
        // reads in her WhatsApp.
        pending: form.pending,
      })),
    }),
  );

  function tick(next: boolean) {
    startTransition(async () => {
      flip(next);
      await setTeacherReminded(teacher.requestIds, next, batchId);
    });
  }

  if (reminded) {
    return (
      <button
        type="button"
        onClick={() => tick(false)}
        disabled={pending}
        title="Not actually sent? Tap to put her back on the list."
        className={`flex min-h-[var(--tap-min)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-confirm-bg)] px-3 text-[13px] font-semibold text-[var(--color-confirm-fg)] transition-transform active:scale-[0.98] ${className}`}
      >
        <CheckCircle aria-hidden size={16} weight="fill" />
        Reminded
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={() => tick(true)}
      className={`${btn()} shrink-0 px-3 text-[13px] ${className}`}
    >
      Remind
    </a>
  );
}

/**
 * When she was last chased, in words.
 *
 * ON ITS OWN LINE wherever this is used, never beside her name.
 * TeacherProgressList's header records that two counts sharing that line cost
 * more than the 4px rail design-qa.md removed for truncating names at 360px.
 *
 * Says the word as well as any colour, per the same rule the tone pills follow:
 * this gets read on a phone in a corridor, and somebody who cannot separate the
 * amber from the red still has to know who has already been chased today.
 */
export function remindedLabel(teacher: {
  remindedToday: boolean;
  lastRemindedAt: Date | null;
  reminderCount: number;
  /** The school's today, from the server — never computed in the browser. */
  today: string;
}): string | null {
  if (teacher.lastRemindedAt === null) return null;

  const times =
    teacher.reminderCount > 1 ? ` · nudged ${teacher.reminderCount}×` : "";
  if (teacher.remindedToday) return `reminded today${times}`;

  const days = daysBetween(teacher.lastRemindedAt, teacher.today);
  if (days <= 0) return `reminded today${times}`;
  return `reminded ${days} ${days === 1 ? "day" : "days"} ago${times}`;
}

/**
 * Whole days between a timestamp and the school's today.
 *
 * Both sides are reduced to a calendar date first, so "yesterday evening" reads
 * as 1 day rather than 0 — the office thinks in days on the register, not in
 * elapsed hours.
 *
 * THE INSTANT IS REDUCED THROUGH isoDay, NOT toISOString. `toISOString` gives the
 * UTC date, and lib/today.ts exists because that is a different day from the
 * school's for five and a half hours out of every twenty-four — a chase recorded
 * at 1am IST would have read as "1 day ago" the moment it was made. isoDay is
 * pure and safe on the client, which is the whole reason that file hardcodes the
 * zone instead of reading an env var.
 */
function daysBetween(at: Date, today: string): number {
  const then = Date.parse(`${isoDay(at)}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((now - then) / 86_400_000);
}
