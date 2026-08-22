"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui/controls";
import { downscale } from "@/components/ui/downscale";
import { useToast } from "@/components/ui/Toast";

/**
 * Replacing a child's photograph, from the office console.
 *
 * The same downscale pass the teacher's phone runs — see components/ui/downscale
 * — so a face that arrives from a desk is stored at exactly the size as one
 * taken in a staffroom, and everything downstream stays ignorant of which.
 *
 * NO OFFLINE QUEUE, deliberately. The teacher surface wraps its uploads in
 * IndexedDB (photo-queue.ts) because a round is forty-six children on a village
 * connection and losing the twelfth would be unforgivable. This is one photo on
 * a desk on school wifi; a failure here is retried by pressing the button
 * again, and a queue would be machinery with nothing to carry.
 *
 * NO FALLBACK TO THE ORIGINAL FILE if downscale throws. A 4 MB camera JPEG
 * would come straight back as a 413, and "photo too large" reads to the office
 * as "this photograph is broken" rather than "your browser could not resize
 * it". Refusing here, with a sentence, is the honest failure — and there is no
 * server-side resize to fall back to (no sharp, by design; see photo-store.ts).
 */
export function PhotoEditor({
  studentId,
  hasPhoto,
}: {
  studentId: string;
  hasPhoto: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    try {
      let full: Blob;
      let thumb: Blob | null;
      try {
        ({ full, thumb } = await downscale(file));
      } catch {
        setError("This browser could not prepare that image. Try a JPEG.");
        return;
      }

      const body = new FormData();
      body.set("studentId", studentId);
      body.set("file", new File([full], "photo.jpg", { type: "image/jpeg" }));
      if (thumb) body.set("thumb", new File([thumb], "thumb.jpg", { type: "image/jpeg" }));

      const response = await fetch("/api/photos", { method: "POST", body });
      if (!response.ok) {
        const said = await response.json().catch(() => null);
        setError(said?.error ?? "That did not go through. Nothing has been changed.");
        return;
      }

      // Same rule as the field form: no undo. The change_log row is append-only
      // and the previous photograph is still in the store but no longer named
      // by the record — putting it back is another deliberate edit.
      toast({ message: "Photograph replaced.", tone: "success" });
      router.refresh();
    } finally {
      setBusy(false);
      // So picking the same file twice in a row still fires a change event.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="mt-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        id={`photo-${studentId}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <label
        htmlFor={`photo-${studentId}`}
        className={`${btn({ tone: "quiet" })} cursor-pointer text-xs ${
          busy ? "pointer-events-none opacity-40" : ""
        }`}
      >
        {busy ? "Uploading…" : hasPhoto ? "Replace photo" : "Add photo"}
      </label>

      {error ? (
        <p role="alert" className="mt-1 max-w-[14rem] text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
