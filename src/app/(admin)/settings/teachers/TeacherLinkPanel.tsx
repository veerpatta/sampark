"use client";

import { useState } from "react";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { issueTeacherLink, revokeTeacherLink } from "./actions";

/**
 * Her durable link: issue it, hand it over, or kill it.
 *
 * The link is the thing that turns a marks round from sixteen WhatsApp messages
 * into none — she saves it once and whatever the school asks for appears on it.
 * So the two controls that matter are handing it over and taking it back.
 *
 * ROTATION IS THE REVOCATION. "Issue a new link" overwrites the column, so the
 * old URL is dead the moment it commits — there is no separate revoke to
 * remember and no window where both work. The plain revoke below it exists for
 * the case where she should have no link at all, not a different one.
 */
export function TeacherLinkPanel({
  teacherId,
  teacherName,
  phone,
  origin,
  token,
  issuedAt,
}: {
  teacherId: string;
  teacherName: string;
  phone: string;
  origin: string;
  token: string | null;
  issuedAt: Date | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!token) {
    return (
      <form action={issueTeacherLink} className="mt-3 border-t border-[var(--color-border)] pt-3">
        <input type="hidden" name="id" value={teacherId} />
        <p className="text-label text-[var(--color-ink-muted)]">
          No personal link yet. With one, she stops needing a WhatsApp message
          every round — whatever is open shows up on the same page.
        </p>
        <button
          type="submit"
          className="mt-2 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-surface-muted)] md:w-auto"
        >
          Issue a personal link
        </button>
      </form>
    );
  }

  const url = `${origin}/t/${token}`;
  // Bilingual, English line over Hindi line, exactly like every other message
  // in lib/whatsapp.ts and like the page this link opens.
  const message = [
    `Namaste ${teacherName},`,
    `नमस्ते ${teacherName} जी,`,
    ``,
    `Whatever the school asks for will appear on this page from now on. Save it:`,
    `विद्यालय जो भी जानकारी माँगेगा, वह अब इसी पेज पर दिखेगी। इसे सहेज कर रखें:`,
    ``,
    url,
    ``,
    `— Veer Patta School office · वीर पत्ता विद्यालय कार्यालय`,
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Refused clipboard access. The URL is on screen and selectable.
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <p className="text-label font-medium">Personal link</p>
      <code className="mt-1 block min-w-0 break-all rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs">
        {url}
      </code>
      {issuedAt ? (
        <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
          issued {issuedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={buildWhatsAppLink(phone, message)}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--color-success)] px-3 text-sm font-medium text-white transition-transform active:scale-[0.98]"
        >
          Send it on WhatsApp
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-[var(--tap-min)] rounded-lg border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <form action={issueTeacherLink}>
          <input type="hidden" name="id" value={teacherId} />
          <button
            type="submit"
            className="inline-flex min-h-[var(--tap-min)] items-center text-label text-[var(--color-brand-600)] hover:underline"
          >
            Issue a new link
          </button>
        </form>
        <form action={revokeTeacherLink}>
          <input type="hidden" name="id" value={teacherId} />
          <button
            type="submit"
            className="inline-flex min-h-[var(--tap-min)] items-center text-label text-[var(--color-danger)] hover:underline"
          >
            Revoke it
          </button>
        </form>
      </div>
      <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
        Either one stops the old link working immediately.
      </p>
    </div>
  );
}
