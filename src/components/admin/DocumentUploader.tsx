"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, field } from "@/components/ui/controls";
import { useToast } from "@/components/ui/Toast";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  formatBytes,
} from "@/lib/documents";

/**
 * Attaching a certificate from the office console.
 *
 * Modelled on PhotoEditor, with one deliberate difference: NO DOWNSCALE. A
 * face at 800px is a face; a scan of a transfer certificate at 800px is a grey
 * rectangle nobody can read. The bytes go up as they are, capped at
 * MAX_DOCUMENT_BYTES, and the cap is checked here first so "too large" is said
 * before a phone spends a minute uploading on school wifi.
 */
export function DocumentUploader({ studentId }: { studentId: string }) {
  const [kind, setKind] = useState<string>(DOCUMENT_KINDS[0].key);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. Eight megabytes is the most a document can be.`);
      if (input.current) input.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set("studentId", studentId);
      body.set("kind", kind);
      body.set("label", label.trim());
      body.set("file", file);

      const response = await fetch("/api/documents", { method: "POST", body });
      if (!response.ok) {
        const said = await response.json().catch(() => null);
        setError(said?.error ?? "That did not go through. Nothing has been attached.");
        return;
      }

      toast({ message: "Document attached.", tone: "success" });
      setLabel("");
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const inputId = `document-${studentId}`;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-ink-muted)]">Kind</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className={`mt-1 ${field()} w-auto`}
        >
          {DOCUMENT_KINDS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0 flex-1">
        <span className="text-xs font-medium text-[var(--color-ink-muted)]">Label (optional)</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          placeholder="e.g. from previous school, 2024"
          className={`mt-1 ${field()}`}
        />
      </label>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <label
        htmlFor={inputId}
        className={`${btn({ tone: "primary" })} cursor-pointer ${busy ? "pointer-events-none opacity-40" : ""}`}
      >
        {busy ? "Uploading…" : "Attach a file"}
      </label>
      {error ? (
        <p role="alert" className="w-full text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
