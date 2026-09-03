"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/**
 * Take a certificate off the record.
 *
 * A browser confirm rather than an undo toast, for the reason RemoveControls
 * gives: the bytes are deleted from the store, so there is nothing to put
 * back. The row stays, marked removed, with the remover's name on it.
 */
export function RemoveDocumentButton({ id, what }: { id: string; what: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  function remove() {
    if (!window.confirm(`Remove this ${what}?\n\nThe file is deleted for good. The record keeps a line saying it was attached and removed, with your name.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        setError("That did not go through. The document is still attached.");
        return;
      }
      toast({ message: "Document removed.", tone: "info" });
      router.refresh();
    });
  }

  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex min-h-[var(--tap-min)] items-center px-2 text-sm text-[var(--color-danger)] hover:underline disabled:opacity-40"
      >
        Remove
      </button>
      {error ? (
        <span role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
