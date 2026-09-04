"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle } from "@phosphor-icons/react";
import {
  buildRoundMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { messageCount } from "@/lib/whatsapp-templates";
import type { QueueGroup } from "@/lib/send-queue";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { btn } from "@/components/ui/controls";

import { useToast } from "@/components/ui/Toast";
import { resume, sendGroupViaApi, setGroupSent } from "./actions";

/**
 * Work through the round one TEACHER at a time, not one link at a time.
 *
 * A marks round is thirty-eight links but only about sixteen teachers, so each
 * card is one teacher and her message carries every link she has: sixteen
 * conversations instead of thirty-eight.
 *
 * TWO WAYS TO SEND. With the API on, "Send" puts the approved template through
 * AiSensy and the card ticks itself; "Send all remaining" walks the queue for
 * the office. With it off — or when it refuses a number, or the day a template
 * is paused — "Open in WhatsApp" is the wa.me link this screen was built on,
 * and it is never removed. The README's rule about the manual path applies to
 * this card more than anywhere: it is the fallback for the fallback.
 *
 * "SENT" MEANS DIFFERENT THINGS ON THE TWO PATHS AND THE CARD SAYS WHICH.
 * wa.me opens in another tab and never tells us what happened there, so a
 * manual tick means "WhatsApp opened" and is tappable to take back. An API
 * send means AiSensy accepted it, and the card shows when. Both land on the
 * same column, so the boards read one fact.
 *
 * THE API BUTTON SENDS NO TEXT. It hands over the card's key; the server
 * rebuilds the message from the same links this card lists. A card whose
 * links cannot all sit on her page (a photo round) is more than one message,
 * and the button says how many before it is pressed.
 */
export function SendQueue({
  batchId,
  title,
  dueDate,
  origin,
  groups,
  apiEnabled = false,
  apiSentAt = {},
}: {
  batchId: string;
  title: string;
  dueDate: string;
  origin: string;
  groups: QueueGroup[];
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
  /** requestId → ISO time of the last successful API send that covered it. */
  apiSentAt?: Record<string, string>;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Per card, what AiSensy said when it refused. Cleared on the next try. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** The card an API send is in flight for, so only its button says so. */
  const [inFlight, setInFlight] = useState<string | null>(null);

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

  /** How many API messages this card is. Says so on the button when >1. */
  function countFor(group: QueueGroup): number {
    return messageCount(
      group.links.map((link) => ({
        requestId: link.requestId,
        token: link.token,
        fieldKeys: link.fieldKeys,
      })),
      group.linkToken,
    );
  }

  /** When this card last went out through the API, if it did. */
  function apiTimeFor(group: QueueGroup): string | null {
    const times = group.links
      .map((link) => apiSentAt[link.requestId])
      .filter((value): value is string => Boolean(value));
    if (times.length === 0) return null;
    const latest = times.reduce((a, b) => (a > b ? a : b));
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(latest));
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

  /**
   * One card through the API. Returns whether it went, for the loop below.
   *
   * Optimistically ticked; useOptimistic falls back to the server's value when
   * the transition ends, so a refusal un-ticks itself.
   */
  async function sendOne(group: QueueGroup, force = false): Promise<boolean> {
    setErrors((current) => {
      const rest = { ...current };
      delete rest[group.key];
      return rest;
    });
    markOptimistic({ key: group.key, sent: true });
    const outcome = await sendGroupViaApi(batchId, group.key, force);
    if (!outcome.ok) {
      setErrors((current) => ({ ...current, [group.key]: outcome.error }));
      return false;
    }
    if (outcome.warning) {
      setErrors((current) => ({ ...current, [group.key]: outcome.warning! }));
    }
    return true;
  }

  function sendViaApi(group: QueueGroup, force = false) {
    setInFlight(group.key);
    startTransition(async () => {
      await sendOne(group, force);
      setInFlight(null);
    });
  }

  /**
   * Every unsent card, in queue order, one after another.
   *
   * Sequential on purpose: sixteen simultaneous calls to a rate-limited API
   * is how half a round arrives and the other half silently does not. A
   * refusal on one card is recorded on that card and the loop carries on —
   * stopping would leave the office guessing which of the rest it reached.
   */
  function sendAll() {
    const queue = rows.filter((group) => !group.sent);
    if (queue.length === 0) return;
    startTransition(async () => {
      let sent = 0;
      const failed: string[] = [];
      for (const group of queue) {
        setInFlight(group.key);
        if (await sendOne(group)) sent += 1;
        else failed.push(group.teacherName);
      }
      setInFlight(null);
      toast({
        message:
          failed.length === 0
            ? `${sent} ${sent === 1 ? "message" : "messages"} sent.`
            : `${sent} sent · ${failed.length} failed: ${failed.join(", ")}`,
        tone: failed.length === 0 ? "success" : "danger",
        duration: failed.length === 0 ? undefined : 8000,
      });
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

  const remaining = rows.filter((group) => !group.sent).length;

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
          {apiEnabled
            ? "One message per teacher, carrying every link she has. Send sends it through WhatsApp; the card ticks itself when it goes."
            : "One message per teacher, carrying every link she has. Tap to open WhatsApp with it ready — come back and the next one is waiting."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {apiEnabled && remaining > 0 ? (
            <button
              type="button"
              onClick={sendAll}
              disabled={pending}
              className={`${btn({ tone: "go" })} disabled:opacity-60`}
            >
              {pending && inFlight
                ? "Sending…"
                : `Send all ${remaining} remaining`}
            </button>
          ) : null}
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
          const count = apiEnabled ? countFor(group) : 1;
          const apiTime = apiTimeFor(group);
          const error = errors[group.key];
          const sending = pending && inFlight === group.key;
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
                    {/* Said before the button is pressed: a photo round with
                        three classes is three messages, not one. */}
                    {count > 1 ? (
                      <span className="ml-1">· {count} messages</span>
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

                  {/* How it went, when it went through the API. A manual tick
                      has no time to show: wa.me never said. */}
                  {group.sent && apiTime ? (
                    <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
                      sent via WhatsApp · {apiTime}
                    </p>
                  ) : null}

                  {error ? (
                    <p className="mt-0.5 text-meta text-[var(--color-danger)]">
                      {error}
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
                  <div className="flex shrink-0 flex-col items-end gap-1">
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
                    {/* The one way past the double-send guard, and it says so. */}
                    {apiEnabled ? (
                      <button
                        type="button"
                        onClick={() => sendViaApi(group, true)}
                        disabled={pending}
                        className="text-xs text-[var(--color-ink-muted)] hover:underline"
                      >
                        Send again
                      </button>
                    ) : null}
                  </div>
                ) : apiEnabled ? (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => sendViaApi(group)}
                      disabled={pending}
                      className={`${btn({ tone: isNext ? "go" : "primary" })} disabled:opacity-60`}
                    >
                      {sending
                        ? "Sending…"
                        : count > 1
                          ? `Send ${count} messages`
                          : "Send"}
                    </button>
                    <a
                      href={chatHref(group)}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={() => handOver(group)}
                      className="text-xs text-[var(--color-ink-muted)] hover:underline"
                    >
                      Open in WhatsApp instead
                    </a>
                  </div>
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
