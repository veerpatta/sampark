"use client";

import Link from "next/link";
import { btn } from "@/components/ui/controls";
import { PageHeader } from "@/components/admin/PageHeader";

/**
 * Something threw, and this is what the office sees instead of a stack trace.
 *
 * Honest and short: nothing was changed by a page that failed to render, so
 * "try again" is safe advice, and the two links go to the places a person
 * standing in a corridor would want next. The message is not shown — a
 * database error naming a table is not for this screen — but the digest is,
 * so it can be matched to a log.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        mobileTitle="content"
        title="That did not load"
        subtitle="Nothing has been changed. Try again; if it keeps happening, tell whoever looks after Sampark."
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={btn({ tone: "primary" })}>
          Try again
        </button>
        <Link href="/students" className={btn()}>
          Students
        </Link>
        <Link href="/" className={btn()}>
          Dashboard
        </Link>
      </div>
      {error.digest ? (
        <p className="font-mono text-xs text-[var(--color-ink-faint)]">ref {error.digest}</p>
      ) : null}
    </div>
  );
}
