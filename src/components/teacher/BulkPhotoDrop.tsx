"use client";

import { useCallback, useRef, useState } from "react";
import { downscale } from "@/components/ui/downscale";
import {
  matchFilename,
  placeFiles,
  type PhotoTarget,
} from "@/lib/photo-filename";
import { usePhotos } from "./photo-context";
import { tick } from "./haptics";
import type { TeacherRosterRow } from "./types";

/**
 * A folder of photographs, placed against a roster in one gesture.
 *
 * THE OFFICE'S HALF OF A PHOTO ROUND IS NOT A CAMERA. A teacher stands in front
 * of forty-six children and takes forty-six photographs — the per-child tile is
 * exactly right for that, and it stays. What the master link is for is the
 * other half: five hundred children and a folder somebody already filled, from
 * a studio visit or an ID-card batch or last year's export. Tapping five
 * hundred tiles to attach five hundred files is the job this removes.
 *
 * NOTHING IS ATTACHED THAT WAS NOT MATCHED WITH EVIDENCE. lib/photo-filename.ts
 * does the deciding, is pure, and refuses rather than guesses — a file that
 * fits two children, or two files that fit one, go to the tray below for a
 * person to place. Everything it does match then travels the ordinary road:
 * downscale, upload against this link's own token, photoBelongsTo on the
 * server, the answer flush, the review queue. There is no new way into a
 * student record here.
 *
 * TWO AT A TIME, WITH A YIELD. Decoding two hundred four-megapixel JPEGs is
 * minutes of main thread, and a tab that stops responding is a tab somebody
 * closes with the work still in it. Two keeps both cores busy and leaves the
 * page able to paint; the await between batches is what lets it.
 */

const DECODE_CONCURRENCY = 2;

type Pending = {
  id: string;
  file: File;
  why: string;
};

export function BulkPhotoDrop({ roster }: { roster: TeacherRosterRow[] }) {
  const photos = usePhotos();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [tray, setTray] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);

  const targets: PhotoTarget[] = roster.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    classLabel: row.classLabel,
    srNo: row.srNo,
  }));

  /** Downscale and hand to the queue. The queue owns everything after this. */
  const attach = useCallback(
    async (studentId: string, file: File) => {
      const { full, thumb } = await downscale(file);
      await photos.capture(studentId, full, thumb);
    },
    [photos],
  );

  const take = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const placed = placeFiles(
        files.map((file) => file.name),
        targets,
      );

      const matched: { file: File; studentId: string }[] = [];
      const unplaced: Pending[] = [];

      placed.forEach((row, index) => {
        const file = files[index]!;
        if (row.match.kind === "matched") {
          matched.push({ file, studentId: row.match.studentId });
        } else {
          unplaced.push({
            id: `${file.name}:${file.size}:${index}`,
            file,
            why:
              row.match.kind === "ambiguous"
                ? row.match.why
                : "no student id, SR number or name in the filename",
          });
        }
      });

      setTray((current) => [...current, ...unplaced]);

      setBusy({ done: 0, total: matched.length });
      try {
        for (let i = 0; i < matched.length; i += DECODE_CONCURRENCY) {
          const slice = matched.slice(i, i + DECODE_CONCURRENCY);
          await Promise.all(
            slice.map((row) =>
              attach(row.studentId, row.file).catch(() => {
                setTray((current) => [
                  ...current,
                  {
                    id: `${row.file.name}:${row.file.size}:failed`,
                    file: row.file,
                    why: "that file could not be read as a photograph",
                  },
                ]);
              }),
            ),
          );
          setBusy({ done: Math.min(i + slice.length, matched.length), total: matched.length });
        }
        if (matched.length > 0) tick();
      } finally {
        setBusy(null);
      }
    },
    [attach, targets],
  );

  /** A file the matcher refused, placed by hand. */
  const place = useCallback(
    async (pending: Pending, studentId: string) => {
      setTray((current) => current.filter((row) => row.id !== pending.id));
      try {
        await attach(studentId, pending.file);
        tick();
      } catch {
        setError(`${pending.file.name} could not be read as a photograph.`);
      }
    },
    [attach],
  );

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void take([...event.dataTransfer.files].filter(isImage));
      }}
      /* Paste is the third way in, and costs one handler: a screenshot or a
         copied file lands here without anyone finding a button. */
      onPaste={(event) => {
        const files = [...event.clipboardData.files].filter(isImage);
        if (files.length > 0) void take(files);
      }}
      className={`-mx-4 border-b px-4 py-4 transition-colors ${
        over
          ? "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
      }`}
    >
      <h2 className="text-base font-semibold">Photos from a folder</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Drop them here, paste them, or choose them. A file whose name carries a
        student ID, an SR number or a child&rsquo;s name is attached on its own.
        Anything else waits below for you to place — nothing is guessed.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].filter(isImage);
          void take(files);
          event.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
        className="mt-3 min-h-14 w-full rounded-[var(--radius-commit)] border border-[var(--color-brand-600)] bg-[var(--color-surface)] px-4 font-semibold text-[var(--color-brand-600)] transition-transform active:scale-[0.98] disabled:opacity-60 md:w-auto"
      >
        {busy ? `Reading ${busy.done} of ${busy.total}…` : "Choose photos"}
      </button>

      {photos.full ? (
        <p className="mt-2 text-sm text-[var(--color-correct-fg)]">
          That is as many as can wait at once. They are uploading — add more when
          the number below comes down.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      {tray.length > 0 ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <h3 className="text-label font-semibold">
            {tray.length} to place by hand
          </h3>
          <ul className="mt-2 space-y-3">
            {tray.map((pending) => (
              <li key={pending.id}>
                <p className="break-all font-mono text-meta">{pending.file.name}</p>
                <p className="text-meta text-[var(--color-ink-muted)]">
                  {pending.why}
                </p>
                <TrayPicker
                  roster={roster}
                  onPick={(studentId) => void place(pending, studentId)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const isImage = (file: File) => file.type.startsWith("image/");

/**
 * Type to narrow, tap to place.
 *
 * A `<select>` of five hundred children is a native wheel nobody can find a
 * name in — the same reason the bus-route field is a datalist and not a select
 * (StudentRow.tsx). This filters as you type and shows at most six, so the
 * answer is always one tap away and never a scroll.
 */
function TrayPicker({
  roster,
  onPick,
}: {
  roster: TeacherRosterRow[];
  onPick: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const hits =
    query.trim().length < 2
      ? []
      : roster
          .filter((row) => {
            const needle = query.trim().toLowerCase();
            return (
              row.name.toLowerCase().includes(needle) ||
              row.studentId.toLowerCase().includes(needle) ||
              (row.srNo ?? "").toLowerCase().includes(needle)
            );
          })
          .slice(0, 6);

  return (
    <div className="mt-1">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name, ID or SR number"
        className="min-h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base"
      />
      {hits.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {hits.map((row) => (
            <li key={row.studentId}>
              <button
                type="button"
                onClick={() => onPick(row.studentId)}
                className="min-h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm transition-transform active:scale-[0.98]"
              >
                <span className="font-medium">{row.name}</span>
                <span className="ml-2 font-mono text-meta text-[var(--color-ink-muted)]">
                  {row.studentId}
                  {row.classLabel ? ` · ${row.classLabel}` : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Re-exported so a caller can ask the same question the drop zone asks. */
export { matchFilename };
