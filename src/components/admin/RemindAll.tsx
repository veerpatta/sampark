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
 * NO CARD OF ITS OWN. It sits at the head of a list that already has edges, and
 * design-qa.md's rule for exactly this — "a frame around rows that already have
 * edges is a second border" — is why it is a divider and a heading rather than
 * a nested box. Driven at 360px the boxed version read as a card inside a card.
 *
 * THE PRIMARY CONTROL IS FULL WIDTH ON A PHONE and returns to its natural size
 * at `sm`. Wrapping a button out of a justify-between row leaves it stranded
 * against an edge, which is what the first pass did.
 *
 * A DELIBERATE SECOND TAP BEFORE THE BULK SEND. Every other confirmation in this
 * codebase was replaced by an undo, because undo is honest and a dialog asking
 * "are you sure" is not. A sent WhatsApp message has no undo — it is out, it is
 * billed, and sixteen at once is the one action here big enough to be worth a
 * moment. The armed state uses the `commit` shape, which the control vocabulary
 * reserves for the button that does the irreversible thing.
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
  // already overdue-first, then whoever is holding up the most children.
  const queue = teachers.filter((teacher) => !teacher.remindedToday);
  // Nothing to collapse below two: one teacher already has her own button
  // directly underneath, and a second control for the same tap is clutter.
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
    <div className="mb-3 border-b border-[var(--color-border)] pb-3">
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
  if (armed) {
    return (
      <div>
        <p className="text-name font-medium">
          Send {count} {count === 1 ? "reminder" : "reminders"} now?
        </p>
        <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
          One WhatsApp message each. This cannot be taken back.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onSend}
            disabled={pending}
            className={`${btn({ shape: "commit", tone: "go" })} flex-1 disabled:opacity-60`}
          >
            {pending ? "Sending…" : `Yes, send ${count}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={`${btn({ shape: "commit" })} px-4`}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {/* Not "Remind all N" a second time. On a phone the button drops to
            full width directly beneath this line, and a heading that repeats
            the control it sits on top of is two thirds of the block saying one
            thing. The heading says what the state IS; the button says what
            pressing it does. */}
        <p className="text-name font-medium">
          {count} still to chase
        </p>
        <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
          One message each. Anyone reminded today is left alone.
        </p>
      </div>
      <button
        type="button"
        onClick={onArm}
        disabled={pending}
        className={`${btn({ tone: "go" })} w-full px-4 sm:w-auto`}
      >
        Remind all {count}
      </button>
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
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <p className="text-name font-medium">
          Next: {next.teacherName}{" "}
          <span className="font-mono text-meta text-[var(--color-ink-muted)]">
            {position} of {total}
          </span>
        </p>
        {/* One line, and only the part the card above has not already said.
            Both surfaces that render this already explain that a tap opens
            WhatsApp and the next one waits; what neither says is WHY it is one
            at a time, and that is the fact this control needs to carry — a
            button claiming otherwise would quietly do nothing for teachers two
            onwards. */}
        <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
          One at a time — that is all WhatsApp allows.
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
        className={`${btn({ tone: "go" })} w-full px-4 sm:w-auto`}
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
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        {sent > 0 ? (
          <CheckCircle
            aria-hidden
            size={16}
            weight="fill"
            className="shrink-0 text-[var(--color-success)]"
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
