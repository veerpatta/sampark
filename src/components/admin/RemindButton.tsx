"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { TeacherReminder } from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn } from "@/components/ui/controls";
import {
  remindTeacherViaApi,
  setTeacherReminded,
} from "@/app/(admin)/requests/reminder-actions";

/**
 * The nudge, addressed to her, carrying everything she still owes — and the tick
 * that records it.
 *
 * ONE MESSAGE PER PERSON, NEVER PER LINK. lib/reminders.ts exists because a
 * button on every row sent a teacher who takes maths for three classes three
 * near-identical messages inside four seconds. Everything here takes a
 * TeacherReminder, which is already collapsed to one entry per (teacher, number).
 *
 * TWO WAYS TO SEND, AND THE MANUAL ONE IS NEVER REMOVED. With the API on,
 * "Remind" sends the approved template through AiSensy, ticks itself, and shows
 * the provider's own sentence when it refuses; "Open in WhatsApp" underneath is
 * the wa.me link it always was, for a number the API will not take or a day the
 * template is paused. With the API off, the wa.me link is the only button and
 * nothing here looks any different from before.
 *
 * THE API BUTTON SENDS NO TEXT. It hands over her key and the round; the server
 * rebuilds the message from the same data this card was drawn from. See
 * lib/whatsapp-send.ts.
 *
 * A REAL LINK WITH THE TICK ON `onClick` for the manual path, and that split is
 * deliberate. A browser never blocks a genuine `<a target="_blank">`, and the
 * page stays alive to record the tap — which is what makes the tick possible at
 * all. Making the button a handler that opened the window would trade a
 * guaranteed delivery for a pop-up-blocker prompt. Same shape as SendQueue's.
 *
 * WHY THIS IS A CLIENT COMPONENT when TeacherProgressList is not. That file's
 * header says every button in it is already an `<a href>` and it therefore needs
 * no client boundary — true until the tick arrived, which needs a transition and
 * an optimistic flip. So the boundary is drawn here, around the one piece that
 * genuinely needs it, rather than turning the whole list client-side.
 *
 * THE ACTION COLUMN IS CAPPED ON A PHONE. Driven at 360px it took 142px of a
 * 294px card — 48% of the row — because "Open in WhatsApp instead" sits under
 * the button and would not wrap. The teacher's name, her classes and the
 * children she owes were sharing what was left, so the name broke across two
 * lines. The cap lets the fallback wrap instead, which is the half of the row
 * that can afford it.
 *
 * The manual message is built at render for the same reason RoundNudge builds
 * its own: it is long enough — longer now that it names children — that handing
 * it down from the server would ship it twice, once as the href and once as the
 * payload.
 */
export function RemindButton({
  teacher,
  origin,
  batchId,
  apiEnabled = false,
  className = "",
}: {
  teacher: TeacherReminder;
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
  /** Set when the chase started on one round's page, so it revalidates too. */
  batchId?: string;
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [reminded, flip] = useOptimistic(
    teacher.remindedToday,
    (_current: boolean, next: boolean) => next,
  );
  /** What AiSensy said when it refused, verbatim. Cleared on the next try. */
  const [note, setNote] = useState<string | null>(null);

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
    setNote(null);
    startTransition(async () => {
      flip(next);
      await setTeacherReminded(teacher.requestIds, next, batchId);
    });
  }

  /**
   * The API send. Optimistically ticked; useOptimistic falls back to the
   * server's value when the transition ends, so a refusal un-ticks itself
   * without a second state to keep in step.
   */
  function sendViaApi(force = false) {
    setNote(null);
    startTransition(async () => {
      flip(true);
      const outcome = await remindTeacherViaApi(teacher.key, batchId, force);
      if (!outcome.ok) setNote(outcome.error);
      else if (outcome.warning) setNote(outcome.warning);
    });
  }

  const noteLine = note ? (
    <span className="max-w-[16rem] text-right text-xs text-[var(--color-danger)]">
      {note}
    </span>
  ) : null;

  if (reminded) {
    return (
      <div className={`flex max-w-[7.5rem] shrink-0 flex-col items-end gap-1 sm:max-w-none ${className}`}>
        <button
          type="button"
          onClick={() => tick(false)}
          disabled={pending}
          title="Not actually sent? Tap to put her back on the list."
          className="flex min-h-[var(--tap-min)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-confirm-bg)] px-3 text-[13px] font-semibold text-[var(--color-confirm-fg)] transition-transform active:scale-[0.98]"
        >
          <CheckCircle aria-hidden size={16} weight="fill" />
          Reminded
        </button>
        {/* The one way past the double-send guard, and it says so. */}
        {apiEnabled ? (
          <button
            type="button"
            onClick={() => sendViaApi(true)}
            disabled={pending}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
            Send again
          </button>
        ) : null}
        {noteLine}
      </div>
    );
  }

  if (!apiEnabled) {
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

  return (
    <div className={`flex max-w-[7.5rem] shrink-0 flex-col items-end gap-1 sm:max-w-none ${className}`}>
      <button
        type="button"
        onClick={() => sendViaApi()}
        disabled={pending}
        className={`${btn({ tone: "go" })} px-3 text-[13px] disabled:opacity-60`}
      >
        {pending ? "Sending…" : "Remind"}
      </button>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => tick(true)}
        className="text-xs text-[var(--color-ink-muted)] hover:underline"
      >
        Open in WhatsApp instead
      </a>
      {noteLine}
    </div>
  );
}
