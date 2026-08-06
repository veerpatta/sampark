"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { buildRequestMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { shareOrWhatsApp } from "@/components/ui/share";
import { useToast } from "@/components/ui/Toast";
import { resume, setSent } from "./actions";

type QueueLink = {
  requestId: string;
  token: string;
  audienceKind: string;
  audienceLabel: string;
  teacherName: string;
  teacherPhone: string;
  rosterSize: number;
  sent: boolean;
};

/**
 * Work through the links one teacher at a time.
 *
 * There is no messaging API behind this — delivery is the share sheet, so a
 * bulk send is N handovers however it is dressed up. What this screen can do is
 * make each one a single tap with no navigation, remember where she got to, and
 * put the next one under her thumb.
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
  links,
}: {
  batchId: string;
  title: string;
  dueDate: string;
  origin: string;
  links: QueueLink[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [rows, markOptimistic] = useOptimistic(
    links,
    (current: QueueLink[], change: { requestId: string; sent: boolean }) =>
      current.map((row) =>
        row.requestId === change.requestId
          ? { ...row, sent: change.sent }
          : row,
      ),
  );

  const done = rows.filter((row) => row.sent).length;
  // The one she should do next: highlighted so the queue reads as a queue.
  const next = rows.find((row) => !row.sent);

  async function handOver(link: QueueLink) {
    const message = buildRequestMessage({
      teacherName: link.teacherName,
      audience: { kind: link.audienceKind, label: link.audienceLabel },
      title,
      dueDate,
      url: `${origin}/r/${link.token}`,
    });

    const outcome = await shareOrWhatsApp({
      message,
      waUrl: buildWhatsAppLink(link.teacherPhone, message),
    });

    // Cancelled means she backed out of the share sheet without sending. Mark
    // nothing — a tick she did not earn is worse than no tick.
    if (outcome === "cancelled") return;

    startTransition(async () => {
      markOptimistic({ requestId: link.requestId, sent: true });
      await setSent(link.requestId, batchId, true);
    });
  }

  function untick(link: QueueLink) {
    startTransition(async () => {
      markOptimistic({ requestId: link.requestId, sent: false });
      await setSent(link.requestId, batchId, false);
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
          {done} of {rows.length} sent
        </h2>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
          <div
            className="h-full rounded-full bg-[var(--color-success)] transition-[width] duration-300"
            style={{
              width: `${rows.length === 0 ? 0 : (done / rows.length) * 100}%`,
            }}
          />
        </div>
        <p className="mt-2 text-label text-[var(--color-ink-muted)]">
          Each teacher gets her own link. Tap to open WhatsApp with the message
          ready — come back and the next one is waiting.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busy}
            className="text-label text-[var(--color-brand-600)] hover:underline disabled:opacity-50"
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
        {rows.map((link) => {
          const isNext = next?.requestId === link.requestId;
          return (
            <li
              key={link.requestId}
              className={`rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-3 shadow-card ${
                isNext
                  ? "border-[var(--color-brand-600)]"
                  : "border-[var(--color-border)]"
              } ${link.sent ? "opacity-70" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-name font-medium">{link.audienceLabel}</p>
                  <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
                    {link.teacherName} · {link.rosterSize}{" "}
                    {link.rosterSize === 1 ? "child" : "children"}
                  </p>
                  <Link
                    href={`/requests/${link.requestId}`}
                    className="mt-0.5 inline-block text-meta text-[var(--color-brand-600)] hover:underline"
                  >
                    open the request
                  </Link>
                </div>

                {link.sent ? (
                  <button
                    type="button"
                    onClick={() => untick(link)}
                    disabled={pending}
                    title="Not actually sent? Tap to put it back in the queue."
                    className="flex min-h-[var(--tap-min)] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-success)] transition-transform active:scale-[0.98]"
                  >
                    ✓ sent
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handOver(link)}
                    className={`min-h-[var(--tap-min)] shrink-0 rounded-lg px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] ${
                      isNext
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--color-brand-600)]"
                    }`}
                  >
                    Send
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {done === rows.length && rows.length > 0 ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
          Every link has gone out. Answers will show up in the review queue as
          they arrive.
        </p>
      ) : null}
    </div>
  );
}
