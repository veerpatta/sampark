"use client";

import { useState, useTransition } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { TeacherReminder } from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn } from "@/components/ui/controls";
import {
  remindEveryoneViaApi,
  setTeacherReminded,
  type BulkReminderOutcome,
} from "@/app/(admin)/requests/reminder-actions";

/**
 * Chase everyone who is still short, without picking them off one at a time.
 *
 * TWO HONEST SHAPES, because the two delivery paths are genuinely different and
 * pretending otherwise would be the lie.
 *
 *   With the API on   — one tap really does send to all of them. The action
 *                       loops server-side, so nothing here depends on the
 *                       browser staying open past the first click.
 *   With the API off  — one tap CANNOT send N WhatsApp messages, and no amount
 *                       of interface will make it. wa.me opens one conversation
 *                       and needs a real user gesture to do it; a loop calling
 *                       window.open would be blocked from the second teacher
 *                       onwards. So the button becomes a QUEUE instead: it
 *                       names who is next, opens her chat, ticks her, and
 *                       advances. The taps stay; the decisions go.
 *
 * The per-teacher buttons underneath are untouched in both modes. This is for
 * the ordinary case — chase the lot — and they are for the exception, which is
 * usually one teacher who needs a different number or a second nudge.
 *
 * A DELIBERATE SECOND TAP BEFORE THE BULK SEND. Every other confirmation in this
 * codebase was replaced by an undo, because undo is honest and a dialog asking
 * "are you sure" is not. A sent WhatsApp message has no undo — it is out, it is
 * billed, and sixteen of them at once is the one action here big enough to be
 * worth a moment. So the button says what it is about to do and asks to be
 * pressed again, which is a confirmation that costs no modal.
 *
 * TAPPING IT TWICE IS SAFE BY CONSTRUCTION. The action never forces, and
 * sendTeacherReminder refuses anyone already reminded today — so a second run
 * sends to whoever was missed and nobody else.
 */
export function RemindAll({
  teachers,
  origin,
  batchId,
  apiEnabled = false,
}: {
  /** Already one entry per (teacher, number). See lib/reminders.ts. */
  teachers: TeacherReminder[];
  /** From the server. See lib/request-origin.ts for why never `window`. */
  origin: string;
  /** Set when the chase is scoped to one round. */
  batchId?: string;
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<BulkReminderOutcome | null>(null);

  // Whoever has not been chased today, in the order the list shows them —
  // which is already overdue-first, then whoever is holding up the most
  // children (groupProgressByTeacher).
  const queue = teachers.filter((teacher) => !teacher.remindedToday);
  // Nothing to collapse below two. One teacher already has her own button
  // directly underneath, and "Remind all 1" beside it is a second control for
  // the same tap.
  if (queue.length < 2) return null;

  function sendAll() {
    setResult(null);
    startTransition(async () => {
      const outcome = await remindEveryoneViaApi(
        queue.map((teacher) => teacher.key),
        batchId,
      );
      setArmed(false);
      setResult(outcome);
    });
  }

  return (
    <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      {apiEnabled ? (
        <SendAll
          count={queue.length}
          armed={armed}
          pending={pending}
          onArm={() => setArmed(true)}
          onSend={sendAll}
          onCancel={() => setArmed(false)}
        />
      ) : (
        <NextInQueue
          queue={queue}
          total={teachers.length}
          origin={origin}
          batchId={batchId}
        />
      )}

      {result ? <Outcome result={result} /> : null}
    </div>
  );
}

/** The API path: one tap, armed by the tap before it. */
function SendAll({
  count,
  armed,
  pending,
  onArm,
  onSend,
  onCancel,
}: {
  count: number;
  armed: boolean;
  pending: boolean;
  onArm: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-name font-medium">
          {armed
            ? `Send ${count} ${count === 1 ? "reminder" : "reminders"} now?`
            : `Remind all ${count}`}
        </p>
        <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
          {armed
            ? "One WhatsApp message each. This cannot be taken back."
            : "One message each, through WhatsApp. Anyone already reminded today is left alone."}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {armed ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-[var(--tap-min)] px-2 text-[13px] text-[var(--color-ink-muted)] hover:underline"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={armed ? onSend : onArm}
          disabled={pending}
          className={`${btn({ tone: "go" })} px-4 text-[13px] disabled:opacity-60`}
        >
          {pending
            ? "Sending…"
            : armed
              ? `Yes, send ${count}`
              : `Remind all ${count}`}
        </button>
      </div>
    </div>
  );
}

/**
 * The manual path: the same list, worked through without choosing.
 *
 * A REAL LINK, and the tick on `onClick`, exactly as the single Remind button
 * is. A browser never blocks a genuine `<a target="_blank">`, and this page
 * stays alive to record the tap — which is what lets the queue advance at all.
 */
function NextInQueue({
  queue,
  total,
  origin,
  batchId,
}: {
  queue: TeacherReminder[];
  total: number;
  origin: string;
  batchId?: string;
}) {
  const [, startTransition] = useTransition();
  const next = queue[0]!;
  const position = total - queue.length + 1;

  const href = buildWhatsAppLink(
    next.phone,
    buildRoundReminderMessage({
      teacherName: next.teacherName,
      teacherPageUrl: next.linkToken
        ? teacherPageUrl(origin, next.linkToken)
        : undefined,
      items: next.forms.map((form) => ({
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
        pending: form.pending,
      })),
    }),
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-name font-medium">
          Next: {next.teacherName}{" "}
          <span className="font-mono text-meta text-[var(--color-ink-muted)]">
            {position} of {total}
          </span>
        </p>
        <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
          {/* Said plainly rather than dressed up as a bulk send: WhatsApp opens
              one chat at a time, and a button claiming otherwise would be a
              button that quietly does nothing for teachers two onwards. */}
          Opens her chat with the message ready, ticks her, and moves to the
          next. WhatsApp can only open one conversation at a time.
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() =>
          startTransition(async () => {
            await setTeacherReminded(next.requestIds, true, batchId);
          })
        }
        className={`${btn({ tone: "go" })} shrink-0 px-4 text-[13px]`}
      >
        Open {next.teacherName.split(" ")[0]}
      </a>
    </div>
  );
}

/** What the run actually did, in the office's words rather than the API's. */
function Outcome({ result }: { result: BulkReminderOutcome }) {
  const { sent, skipped, failed, stopped } = result;
  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <p className="flex items-center gap-1.5 text-sm">
        {sent > 0 ? (
          <CheckCircle
            aria-hidden
            size={16}
            weight="fill"
            className="text-[var(--color-success)]"
          />
        ) : null}
        <span className="font-medium">
          {sent} {sent === 1 ? "reminder" : "reminders"} sent
        </span>
        {skipped > 0 ? (
          <span className="text-[var(--color-ink-muted)]">
            · {skipped} already reminded today
          </span>
        ) : null}
      </p>

      {failed.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {failed.map((row) => (
            <li key={row.teacher} className="text-xs text-[var(--color-danger)]">
              {/* The provider's own sentence, verbatim. A paraphrase is how an
                  office ends up unable to tell a bad number from a paused
                  template. */}
              {row.error}
            </li>
          ))}
        </ul>
      ) : null}

      {stopped ? (
        <p className="mt-1 text-xs text-[var(--color-danger)]">
          Stopped after three refusals in a row — that is usually the key, the
          template or the account rather than the numbers. Nobody after that
          point was contacted.
        </p>
      ) : null}
    </div>
  );
}
