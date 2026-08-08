"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { revokeAllTeacherLinks } from "./actions";

/**
 * The global off switch for durable teacher links.
 *
 * Pull this and every personal page 404s at once — for a round collecting
 * something a permanent URL should not front, or because one leaked and nobody
 * knows which. Sends go back to the way they worked before durable links
 * existed: one grouped WhatsApp message per teacher, which is why that path is
 * never removed.
 *
 * Confirmed, because it is not undoable: re-issuing gives everyone a NEW link
 * and every saved one is gone, so the cost of pulling it is one grouped send.
 */
export function RevokeAllLinks({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (count === 0) return null;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] p-4">
      <p className="text-sm font-medium text-[var(--color-danger)]">
        {count} {count === 1 ? "teacher has" : "teachers have"} a personal link
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Revoking all of them is the switch for a round that should not sit on a
        permanent page. Sends fall back to one WhatsApp message per teacher, and
        anyone you re-issue to gets a new URL — every saved one stops working.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Revoke all ${count} personal links?\n\nEvery teacher's saved page stops working immediately. This cannot be undone — re-issuing gives each of them a different link.`,
            )
          ) {
            return;
          }
          startTransition(async () => {
            await revokeAllTeacherLinks();
            router.refresh();
            toast({
              message: `Revoked ${count} personal links.`,
              tone: "danger",
            });
          });
        }}
        className="mt-3 min-h-[var(--tap-min)] rounded-lg border border-[var(--color-danger)] px-4 text-sm font-medium text-[var(--color-danger)] disabled:opacity-50"
      >
        Revoke all {count} personal links
      </button>
    </div>
  );
}
