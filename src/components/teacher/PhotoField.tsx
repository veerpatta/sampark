"use client";

import { useRef, useState } from "react";
import { UserCircle } from "@phosphor-icons/react";
import { Bi } from "./Bi";
import { downscale } from "@/components/ui/downscale";
import { tick } from "./haptics";
import { usePhotos } from "./photo-context";
import { T } from "./strings";

/**
 * One child's photograph, taken on the phone she is already holding.
 *
 * TWO BUTTONS, NOT ONE. `capture="environment"` opens the camera directly,
 * which is right for the child standing in front of her — but on several
 * Android browsers it removes the gallery option outright, and for the child
 * who was absent last week she may already have the photo. One input cannot
 * reliably offer both, so there are two.
 *
 * NOTHING IS WRITTEN INTO THE ROW UNTIL THE SCHOOL HAS THE BYTES. The preview
 * is local and instant; the value only appears once the upload returns a
 * pathname. That means a photo waiting for signal leaves the row `partial` —
 * open, counted, visibly unfinished — which is exactly the truth, and it is
 * why autosave.ts needed no change. See photo-context.tsx.
 */
export function PhotoField({
  studentId,
  studentName,
  /** The pathname already on record, if any. */
  value,
  missing,
}: {
  studentId: string;
  studentName: string;
  value: string;
  missing: boolean;
}) {
  const photos = usePhotos();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const status = photos.statusFor(studentId);
  const preview = photos.previewFor(studentId);
  const stored = value
    ? `/api/r/${photos.token}/photo?p=${encodeURIComponent(value)}`
    : null;
  const shown = preview ?? stored;

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    setWorking(true);
    try {
      const { full, thumb } = await downscale(file);
      tick();
      await photos.capture(studentId, full, thumb);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That photo did not work.");
    } finally {
      setWorking(false);
      // Clearing the input is what makes retaking the SAME file work: without
      // it the second pick is not a change event and nothing happens.
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="block text-label text-[var(--color-ink-muted)]">
        <Bi t={T.photoLabel} />
      </span>

      <div className="mt-1 flex items-start gap-3">
        {shown ? (
          // A plain <img>: next/image cannot optimise a private blob served
          // through an authenticated proxy, and pointing the optimiser at one
          // would mean caching children's photographs on the CDN.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt={studentName}
            className="h-24 w-24 shrink-0 rounded-[var(--radius-card)] border border-[var(--color-border)] object-cover"
          />
        ) : (
          // A drawn icon, not an emoji. 🙂 rendered as whatever face the
          // teacher's phone happened to ship — yellow and grinning on most
          // Android builds — which is a cheerful cartoon sitting where a
          // photograph of a child is missing. It was also the last emoji in the
          // app, against the rule in design-qa.md.
          <div
            className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed ${
              missing
                ? "border-[var(--color-partial-border)] text-[var(--color-partial-fg)]"
                : "border-[var(--color-border)] text-[var(--color-ink-faint)]"
            }`}
            aria-hidden
          >
            <UserCircle size={40} weight="thin" />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <Capture
            inputRef={cameraRef}
            capture
            onFile={take}
            disabled={working}
            phrase={shown ? T.retake : T.takePhoto}
          />
          <Capture
            inputRef={galleryRef}
            onFile={take}
            disabled={working}
            phrase={T.fromGallery}
          />
        </div>
      </div>

      <Progress status={status} working={working} />

      {photos.full ? (
        <p className="mt-2 text-sm font-medium text-[var(--color-warning-fg)]">
          <Bi t={T.photoQueueFull} />
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {missing && status.state === "idle" && !shown ? (
        <span className="mt-1 block text-sm font-medium text-[var(--color-partial-fg)]">
          <Bi t={T.stillToFill} />
        </span>
      ) : null}
    </div>
  );
}

/** A file input dressed as a button. The input itself is never visible. */
function Capture({
  inputRef,
  capture,
  onFile,
  disabled,
  phrase,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  capture?: boolean;
  onFile: (file: File | undefined) => void;
  disabled: boolean;
  phrase: { en: string; hi: string };
}) {
  return (
    <label
      className={`flex min-h-12 w-full cursor-pointer flex-col items-center justify-center rounded-[var(--radius-control)] border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)] px-3 py-2 text-center text-sm font-semibold text-[var(--color-brand-700)] transition-transform active:scale-[0.98] ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture: "environment" as const } : {})}
        disabled={disabled}
        onChange={(event) => onFile(event.target.files?.[0])}
        className="sr-only"
      />
      <Bi t={phrase} />
    </label>
  );
}

/**
 * Where the photo actually is, said in the same two-state vocabulary the rest
 * of the surface uses: on the phone, or at the school.
 */
function Progress({
  status,
  working,
}: {
  status: ReturnType<ReturnType<typeof usePhotos>["statusFor"]>;
  working: boolean;
}) {
  if (working) {
    return (
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.preparingPhoto} />
      </p>
    );
  }

  if (status.state === "uploading") {
    return (
      <div className="mt-2">
        <p className="text-sm font-medium text-[var(--color-brand-700)]">
          <Bi t={T.sendingPhoto(status.percent)} />
        </p>
        <div
          role="progressbar"
          aria-valuenow={status.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-brand-600)] transition-[width] duration-200 ease-out"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (status.state === "queued" || status.state === "failed") {
    return (
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.photoWaiting} />
      </p>
    );
  }

  if (status.state === "unsaved") {
    return (
      <p className="mt-2 text-sm font-medium text-[var(--color-warning-fg)]">
        <Bi t={T.photoNotSaved} />
      </p>
    );
  }

  return null;
}
