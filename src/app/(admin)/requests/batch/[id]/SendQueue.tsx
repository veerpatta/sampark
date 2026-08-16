"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle } from "@phosphor-icons/react";
import {
  buildRoundMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import type { QueueGroup } from "@/lib/send-queue";
import { ProgressBar } from "@/components/admin/ProgressBar";

import { useToast } from "@/components/ui/Toast";
import { resume, setGroupSent } from "./actions";

/**
 * Work through the round one TEACHER at a time, not one link at a time.
 *
 * There is no messaging API behind this — delivery is a wa.me link, so a bulk
 * send is N handovers however it is dressed up. What this screen can do is make
 * N as small as it honestly gets. A marks round is thirty-eight links but only
 * about sixteen teachers, so each card is one teacher and her message carries
 * every link she has: sixteen conversations instead of thirty-eight.
 *
 * "SENT" MEANS "WHATSAPP OPENED", AND THE TICK IS TAPPABLE TO TAKE BACK.
 * wa.me opens in another tab and never tells us what happened there, so this is
 * the closest thing to proof available. Treating it as sent is what lets the
 * queue advance at all; being able to untick it is what makes that honest. No
 * modal asking "did you send it?" — she has not done it yet when the modal
 * appears, so she would only be guessing.
 */
export function SendQueue({
  batchId,
  title,
  dueDate,
  origin,
  groups,
}: {
  batchId: string;
  title: string;
  dueDate: string;
  origin: string;
  groups: QueueGroup[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [rows, markOptimistic] = useOptimistic(
    groups,
    (current: QueueGroup[], change: { key: string; sent: boolean }) =>
      current.map((group) =>
        group.key === change.key
          ? {
              ...group,
              sent: change.sent,
              sentCount: change.sent ? group.links.length : 0,
            }
          : group,
      ),
  );

  const done = rows.filter((group) => group.sent).length;
  const totalLinks = rows.reduce((sum, group) => sum + group.links.length, 0);
  const totalStudents = rows.reduce((sum, group) => sum + group.students, 0);
  // The one she should do next: highlighted so the queue reads as a queue.
  const next = rows.find((group) => !group.sent);

  /**
   * The one message that carries everything this teacher has to do.
   *
   * Built at render so the button can be a real anchor. A browser never blocks
   * a genuine link, this page stays alive to record the tick, and — the point —
   * it goes to HER number with all of her links in it, not to a share sheet
   * that has no idea who she is.
   *
   * Every link on the card goes in, including any already ticked. Rebuilding
   * from only-the-unsent would produce a second, different message for the same
   * round, and she has no way to reconcile the two.
   */
  function chatHref(group: QueueGroup) {
    return buildWhatsAppLink(
      group.phone,
      buildRoundMessage({
        teacherName: group.teacherName,
        title,
        dueDate,
        links: group.links.map((link) => ({
          audience: {
            kind: link.audienceKind,
            label: link.audienceLabel,
            fieldKeys: link.fieldKeys,
            classLabels: link.classLabels,
          },
          url: `${origin}/r/${link.token}`,
        })),
        // Ride-along delivery. Always included when she has one: it is three
        // lines, it is idempotent, and it re-teaches the habit for free on
        // every round the office does choose to push.
        teacherPageUrl: group.linkToken
          ? teacherPageUrl(origin, group.linkToken)
          : undefined,
      }),
    );
  }

  function handOver(group: QueueGroup) {
    startTransition(async () => {
      markOptimistic({ key: group.key, sent: true });
      await setGroupSent(group.links.map((l) => l.requestId), batchId, true);
    });
  }

  function untick(group: QueueGroup) {
    startTransition(async () => {
      markOptimistic({ key: group.key, sent: false });
      await setGroupSent(group.links.map((l) => l.requestId), batchId, false);
    });
  }

  async function finish() {
    setBusy(true);
    const result = await resume(batchId);
    setBusy(false);
    setNote(
      result.error
        ? result.error
        : result.created === 0
          ? "Nothing was missing."
          : `Created ${result.created} more.`,
    );
    if (!result.error && result.created > 0) {
      toast({ message: `Created ${result.created} more links.`, tone: "success" });
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
        <h2 className="text-title font-semibold">
          {done} of {rows.length} {rows.length === 1 ? "message" : "messages"} sent
        </h2>
        {/* Fixed green, unlike the status board's tone-driven bar. This counts
            messages that have actually gone, and there is no state it could
            disagree with — a sent message is not "in progress". */}
        <ProgressBar
          value={done}
          max={rows.length}
          tone="bg-[var(--color-success)]"
          label="Messages sent in this round"
          className="mt-2 h-1.5"
        />
        {/* Both numbers, so the count above reconciles with the board's,
            which counts links. A teacher with three subjects is one message. */}
        <p className="mt-1 font-mono text-meta text-[var(--color-ink-muted)]">
          {totalLinks} {totalLinks === 1 ? "link" : "links"} · {totalStudents}{" "}
          {totalStudents === 1 ? "child" : "children"}
        </p>
        <p className="mt-2 text-label text-[var(--color-ink-muted)]">
          One message per teacher, carrying every link she has. Tap to open
          WhatsApp with it ready — come back and the next one is waiting.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busy}
            className="inline-flex min-h-[var(--tap-min)] items-center text-label text-[var(--color-brand-600)] hover:underline disabled:opacity-50"
          >
            {busy ? "Checking…" : "Any links missing? Finish the batch"}
          </button>
          {note ? (
            <span className="text-label text-[var(--color-ink-muted)]">
              {note}
            </span>
          ) : null}
        </div>
      </section>

      <ul className="space-y-2">
        {rows.map((group) => {
          const isNext = next?.key === group.key;
          const many = group.links.length > 1;
          return (
            <li
              key={group.key}
              className={`rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-3 shadow-card ${
                isNext
                  ? "border-[var(--color-brand-600)]"
                  : "border-[var(--color-border)]"
              } ${group.sent ? "opacity-70" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-name font-medium">{group.teacherName}</p>
                  <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
                    {group.links.length}{" "}
                    {group.links.length === 1 ? "link" : "links"} ·{" "}
                    {group.students}{" "}
                    {group.students === 1 ? "child" : "children"}
                    {/* The number matters when it is not her saved one — that
                        is the whole reason this card exists separately. */}
                    {group.overridden ? (
                      <span className="ml-1 font-mono">→ {group.phone}</span>
                    ) : null}
                    {group.linkToken ? (
                      <span className="ml-1 text-[var(--color-confirm-fg)]">
                        + her page
                      </span>
                    ) : null}
                  </p>

                  {/* Not reachable by sending: the message carries every link
                      at once. It happens when Resume adds a link after she was
                      ticked, or when the office unticks one — both mean the
                      message she got did not cover everything. */}
                  {group.sentCount > 0 && !group.sent ? (
                    <p className="mt-0.5 text-meta text-[var(--color-correct-fg)]">
                      {group.sentCount} of {group.links.length} handed over —
                      this message carries all {group.links.length}
                    </p>
                  ) : null}

                  <ul className="mt-1 space-y-0.5">
                    {group.links.map((link) => (
                      <li key={link.requestId}>
                        <Link
                          href={`/requests/${link.requestId}`}
                          className="inline-flex min-h-[var(--tap-min)] items-center text-meta text-[var(--color-brand-600)] hover:underline"
                        >
                          {link.audienceLabel}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                {group.sent ? (
                  <button
                    type="button"
                    onClick={() => untick(group)}
                    disabled={pending}
                    title="Not actually sent? Tap to put it back in the queue."
                    className="flex min-h-[var(--tap-min)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-confirm-bg)] px-3 text-sm font-semibold text-[var(--color-confirm-fg)] transition-transform active:scale-[0.98]"
                  >
                    <CheckCircle aria-hidden size={16} weight="fill" />
                    Sent
                  </button>
                ) : (
                  <a
                    href={chatHref(group)}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() => handOver(group)}
                    className={`flex min-h-[var(--tap-min)] shrink-0 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] ${
                      isNext
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--color-brand-600)]"
                    }`}
                  >
                    {many ? `Send all ${group.links.length}` : "Send"}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {done === rows.length && rows.length > 0 ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
          Every message has gone out. Answers will show up in the review queue
          as they arrive.
        </p>
      ) : null}
    </div>
  );
}
