"use client";

import { useCallback, useRef, useState } from "react";
import { Images, X } from "@phosphor-icons/react";
import { downscale } from "@/components/ui/downscale";
import {
  placeFiles,
  type PhotoTarget,
} from "@/lib/photo-filename";
import { usePhotos } from "./photo-context";
import { tick } from "./haptics";
import { Bi } from "./Bi";
import { T, type Phrase } from "./strings";
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
 * A PHONE FIRST, LIKE EVERY OTHER SCREEN ON THIS SURFACE. The office opens this
 * on a laptop often and on a phone in a corridor often enough, and the two want
 * opposite things from the same block: dropping and pasting are pointer verbs
 * and are offered only at `md`, while the button that works everywhere is
 * full-width, 56px, and first. The whole thing is one column at 320px and never
 * scrolls sideways.
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
  why: Phrase;
};

export function BulkPhotoDrop({ roster }: { roster: TeacherRosterRow[] }) {
  const photos = usePhotos();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [attached, setAttached] = useState(0);
  const [tray, setTray] = useState<Pending[]>([]);
  const [error, setError] = useState<Phrase | null>(null);

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
          return;
        }
        unplaced.push({
          id: `${file.name}:${file.size}:${index}:${Date.now()}`,
          file,
          why:
            row.match.kind === "none"
              ? T.bulkNoClue
              : row.match.why.includes("same child")
                ? T.bulkTwoFiles
                : T.bulkTwoChildren,
        });
      });

      setTray((current) => [...current, ...unplaced]);

      setBusy({ done: 0, total: matched.length });
      try {
        for (let i = 0; i < matched.length; i += DECODE_CONCURRENCY) {
          const slice = matched.slice(i, i + DECODE_CONCURRENCY);
          await Promise.all(
            slice.map((row) =>
              attach(row.studentId, row.file)
                .then(() => setAttached((n) => n + 1))
                .catch(() => {
                  setTray((current) => [
                    ...current,
                    {
                      id: `${row.file.name}:${row.file.size}:failed:${Date.now()}`,
                      file: row.file,
                      why: T.bulkUnreadable(row.file.name),
                    },
                  ]);
                }),
            ),
          );
          setBusy({
            done: Math.min(i + slice.length, matched.length),
            total: matched.length,
          });
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
        setAttached((n) => n + 1);
        tick();
      } catch {
        setError(T.bulkUnreadable(pending.file.name));
      }
    },
    [attach],
  );

  return (
    <section
      /* Pointer verbs. Harmless on a phone — no touch gesture fires either —
         and the copy that advertises them is hidden below md so nothing on a
         phone tells her to do something she cannot. */
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
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Images aria-hidden size={22} weight="duotone" className="shrink-0" />
        <Bi t={T.bulkHeading} />
      </h2>

      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.bulkHowPhone} />
      </p>
      {/* Pointer-only, so a phone is never told to drag anything. */}
      <p className="mt-1 hidden text-sm text-[var(--color-ink-muted)] md:block">
        <Bi t={T.bulkHowDesktop} />
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
          // Clearing is what makes picking the SAME folder twice work: without
          // it the second pick is not a change event. Same reason PhotoField
          // clears its camera input.
          event.target.value = "";
        }}
      />

      {/* Full width and 56px on a phone, sized down to its own width at md —
          the same shape the "All N are correct" button uses one section down. */}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
        className="mt-3 min-h-14 w-full rounded-[var(--radius-card)] border border-[var(--color-brand-600)] bg-[var(--color-surface)] px-4 font-semibold text-[var(--color-brand-600)] transition-transform active:scale-[0.98] disabled:opacity-60 md:w-auto"
      >
        <Bi t={busy ? T.bulkReading(busy.done, busy.total) : T.bulkChoose} />
      </button>

      {attached > 0 ? (
        <p className="mt-2 text-sm text-[var(--color-confirm-fg)]">
          <Bi t={T.bulkAttached(attached)} />
        </p>
      ) : null}

      {photos.full ? (
        <p className="mt-2 text-sm text-[var(--color-correct-fg)]">
          <Bi t={T.bulkFull} />
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">
          <Bi t={error} />
        </p>
      ) : null}

      {tray.length > 0 ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <h3 className="text-base font-semibold">
            <Bi t={T.bulkTrayHeading(tray.length)} />
          </h3>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            <Bi t={T.bulkTrayWhy} />
          </p>

          {/* One card per file. Full-bleed on a phone so the picker inside it
              gets the whole width; a bordered list at md. */}
          <ul className="mt-3 space-y-3">
            {tray.map((pending) => (
              <li
                key={pending.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-partial-border)] bg-[var(--color-surface)] p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-meta">
                      {pending.file.name}
                    </p>
                    <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
                      <Bi t={pending.why} />
                    </p>
                  </div>
                  {/* A file she does not want placed at all. 48px, because it
                      sits beside a filename that wraps to three lines. */}
                  <button
                    type="button"
                    aria-label={T.bulkRemoveFile.en}
                    onClick={() =>
                      setTray((current) =>
                        current.filter((row) => row.id !== pending.id),
                      )
                    }
                    className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] transition-transform active:scale-[0.98]"
                  >
                    <X aria-hidden size={18} />
                  </button>
                </div>

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
 * answer is always one tap away and never a scroll. Each hit is a 56px row,
 * because it is the control that decides whose face this is.
 */
function TrayPicker({
  roster,
  onPick,
}: {
  roster: TeacherRosterRow[];
  onPick: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hits =
    needle.length < 2
      ? []
      : roster
          .filter(
            (row) =>
              row.name.toLowerCase().includes(needle) ||
              row.studentId.toLowerCase().includes(needle) ||
              (row.srNo ?? "").toLowerCase().includes(needle),
          )
          .slice(0, 6);

  return (
    <div className="mt-3">
      <label className="block">
        <span className="sr-only">
          <Bi t={T.bulkPickChild} />
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={T.bulkPickChild.en}
          autoCapitalize="words"
          className="min-h-14 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
        />
      </label>

      {hits.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {hits.map((row) => (
            <li key={row.studentId}>
              <button
                type="button"
                onClick={() => onPick(row.studentId)}
                className="flex min-h-14 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left transition-transform active:scale-[0.98]"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {row.name}
                </span>
                <span className="shrink-0 font-mono text-meta text-[var(--color-ink-muted)]">
                  {row.classLabel ?? row.studentId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
