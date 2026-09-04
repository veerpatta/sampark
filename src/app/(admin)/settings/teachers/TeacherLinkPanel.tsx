"use client";

import { useState, useTransition } from "react";
import { buildWhatsAppLink, teacherPageUrl } from "@/lib/whatsapp";
import { useCopy } from "@/components/ui/useCopy";
import {
  issueTeacherLink,
  revokeTeacherLink,
  sendTeacherLinkViaApi,
} from "./actions";

/**
 * Her durable link: issue it, hand it over, or kill it.
 *
 * The link is the thing that turns a marks round from sixteen WhatsApp messages
 * into none — she saves it once and whatever the school asks for appears on it.
 * So the two controls that matter are handing it over and taking it back.
 *
 * TWO WAYS TO HAND IT OVER. With the API on, "Send it" puts the approved
 * `link` template through AiSensy — a button on her phone that opens the page.
 * The wa.me button beside it is the manual message it always was, and stays
 * for the same reason it stays everywhere else.
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
  apiEnabled = false,
}: {
  teacherId: string;
  teacherName: string;
  phone: string;
  origin: string;
  token: string | null;
  issuedAt: Date | null;
  /** Whether AISENSY_API_KEY is set on this deployment. From the server. */
  apiEnabled?: boolean;
}) {
  const { copy, copied } = useCopy();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

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
          className="mt-2 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-surface-muted)] md:w-auto"
        >
          Issue a personal link
        </button>
      </form>
    );
  }

  const url = teacherPageUrl(origin, token);
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

  function sendViaApi() {
    setNote(null);
    startTransition(async () => {
      const outcome = await sendTeacherLinkViaApi(teacherId);
      setNote(outcome.ok ? (outcome.warning ?? "Sent.") : outcome.error);
    });
  }

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <p className="text-label font-medium">Personal link</p>
      <code className="mt-1 block min-w-0 break-all rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs">
        {url}
      </code>
      {issuedAt ? (
        <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
          issued {issuedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {apiEnabled ? (
          <button
            type="button"
            onClick={sendViaApi}
            disabled={pending}
            className="flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-control)] bg-[var(--color-success)] px-3 text-sm font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send it through WhatsApp"}
          </button>
        ) : null}
        <a
          href={buildWhatsAppLink(phone, message)}
          target="_blank"
          rel="noreferrer noopener"
          className={`flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-control)] px-3 text-sm font-medium transition-transform active:scale-[0.98] ${
            apiEnabled
              ? "border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              : "bg-[var(--color-success)] text-white"
          }`}
        >
          {apiEnabled ? "Open in WhatsApp instead" : "Send it on WhatsApp"}
        </a>
        <button
          type="button"
          onClick={() => void copy(url)}
          className="min-h-[var(--tap-min)] rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note ? (
        <p className="mt-1 text-meta text-[var(--color-ink-muted)]">{note}</p>
      ) : null}

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
