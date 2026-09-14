import { isJpeg, THUMB_SUFFIX } from "./photos";

/**
 * Whether the photograph we hold for a child is one anybody can actually look
 * at — and, when it is not, what the rest of the app should do about it.
 *
 * THE BUG THIS EXISTS FOR. `students.photo_path` was the entire answer to "has
 * this child been photographed", and a pathname is not a photograph. An upload
 * cut off halfway over a village connection, a blob that has gone missing, a
 * file that is not a JPEG at all — each leaves a row that counts as done in
 * every total this app draws and renders as a broken grey square on every
 * screen. The office's "No photo" list is the children whose column is empty,
 * so those children appeared in NO list at all: finished and unphotographed at
 * the same time, findable only by somebody noticing a broken square and saying
 * so.
 *
 * So a broken photograph is now, everywhere and without exception, NO
 * PHOTOGRAPH. The "No photo" filter finds it, the completeness bar does not
 * count it, the heatmap does not count it, a gap round asks a teacher for it
 * again, the export says "no photo", and the board draws the child's initials
 * instead of a broken image.
 *
 * PURE, AND NO NODE IMPORTS — the rule lib/photos.ts states at length. These
 * predicates are read by the teacher's snapshot builder and by components, so a
 * `node:` import here would ride a cheap Android's 3G. The byte inspection below
 * takes a plain Uint8Array for the same reason; the code that FETCHES those
 * bytes lives in lib/photo-store.ts, on the server side of that line.
 */

/**
 * The four ways a photograph fails, as stored in `students.photo_broken_reason`.
 *
 * Kept apart rather than collapsed into one "broken", because the office does
 * different things about them. `missing` and `unreadable` mean the bytes are
 * gone and the child has to be photographed again. `truncated` means a phone
 * lost signal mid-upload, which will happen again to the same teacher on the
 * same connection. `not-an-image` should be impossible — both upload routes
 * sniff the bytes — so one appearing is a signal about this app, not about a
 * child.
 */
export const PHOTO_DEFECTS = [
  "missing",
  "unreadable",
  "not-an-image",
  "truncated",
] as const;

export type PhotoDefect = (typeof PHOTO_DEFECTS)[number];

export function isPhotoDefect(value: unknown): value is PhotoDefect {
  return typeof value === "string" && (PHOTO_DEFECTS as readonly string[]).includes(value);
}

/** What the office is told. A sentence, because it is an explanation. */
export const PHOTO_DEFECT_LABELS: Record<PhotoDefect, string> = {
  missing: "The photo file is no longer in the store",
  unreadable: "The photo file would not open",
  "not-an-image": "The file on record is not a photograph",
  truncated: "The upload was cut off before it finished",
};

/** The same thing beside a name, where there is room for three words. */
export const PHOTO_DEFECT_SHORT: Record<PhotoDefect, string> = {
  missing: "Photo file missing",
  unreadable: "Photo will not open",
  "not-an-image": "Not a photograph",
  truncated: "Photo upload cut off",
};

/**
 * The columns any of this needs.
 *
 * A structural type rather than `Pick<Student, …>`: a whole row satisfies it,
 * and so does the four-column select a list page makes.
 */
export type PhotoState = {
  photoPath: string | null;
  photoBrokenPath: string | null;
  photoBrokenReason?: string | null;
};

/**
 * Is the photograph on this row known to be broken, and how?
 *
 * THE COMPARISON IS THE WHOLE MECHANISM. A mark is stored against the pathname
 * it was found on, and a replacement photograph always gets a fresh pathname —
 * lib/photos.ts mints one and never overwrites — so an old mark stops matching
 * of its own accord the instant a good photo is attached. No write path has to
 * remember to clear anything. See the column's comment in drizzle/schema.ts.
 *
 * Returns null both when the photo is fine and when there is no photo at all.
 * "No photo" is not a defect; it is the ordinary empty state every screen in
 * this app already handles.
 */
export function photoDefect(student: PhotoState): PhotoDefect | null {
  if (!student.photoPath || !student.photoBrokenPath) return null;
  if (student.photoBrokenPath !== student.photoPath) return null;
  // A mark whose reason we do not recognise is still a mark. The reason is for
  // the office to read; WHETHER the photo counts is decided by the pathname
  // alone, so a reason code added later can never quietly make one count again.
  return isPhotoDefect(student.photoBrokenReason)
    ? student.photoBrokenReason
    : "unreadable";
}

/** A photograph that can be shown. The question nearly every caller is asking. */
export function hasUsablePhoto(student: PhotoState): boolean {
  return Boolean(student.photoPath) && photoDefect(student) === null;
}

/**
 * The pathname to render, or null.
 *
 * THIS IS WHY THE COMPONENTS DID NOT HAVE TO CHANGE. Avatar draws initials for
 * a null pathname and StudentPhoto draws an em dash, which is exactly what a
 * photograph that will not open should draw — so each call site passes the
 * child through here instead of reaching for `student.photoPath`, and a broken
 * face becomes an ordinary empty one with no new prop and no new branch on any
 * screen.
 */
export function usablePhotoPath(student: PhotoState): string | null {
  return hasUsablePhoto(student) ? student.photoPath : null;
}

/**
 * Below this, whatever is in the store is not a photograph of a child.
 *
 * An 800px q0.8 JPEG out of components/ui/downscale is about 50 kB and the 96px
 * thumbnail about 2.5 kB, so half a kilobyte is an order of magnitude under the
 * smallest thing this app ever writes. Set deliberately far down there: this
 * floor is meant to catch a stub — a zero-length blob, a few bytes of header —
 * not to second-guess a camera.
 */
export const MIN_PHOTO_BYTES = 512;

/**
 * Are these bytes a whole photograph?
 *
 * A TRUNCATED JPEG PASSES `isJpeg`, and that is the failure this adds. That
 * check reads the three-byte SOI marker at the FRONT, which is the right guard
 * on an upload route, where the question is whether somebody is storing an HTML
 * page under a .jpg name. It cannot tell a complete photograph from the first
 * 8 kB of one — and the first 8 kB of one is exactly what a phone that lost
 * signal mid-upload leaves behind. The end-of-image marker is what says the
 * file finished arriving.
 *
 * SCANNED OVER THE LAST FEW BYTES rather than asserted at the very end: some
 * encoders pad after the EOI, and a file that is complete but carries a trailing
 * byte must not put a child back on a list to be photographed again.
 */
export function inspectPhotoBytes(
  bytes: Uint8Array | null | undefined,
): PhotoDefect | null {
  if (!bytes || bytes.length === 0) return "missing";
  if (!isJpeg(bytes)) return "not-an-image";
  if (bytes.length < MIN_PHOTO_BYTES) return "truncated";
  return endsWithEOI(bytes) ? null : "truncated";
}

const EOI_SCAN = 32;

function endsWithEOI(bytes: Uint8Array): boolean {
  const from = Math.max(0, bytes.length - EOI_SCAN);
  for (let i = bytes.length - 2; i >= from; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }
  return false;
}

/**
 * The full-size pathname a thumbnail belongs to — thumbPathname, backwards.
 *
 * Every row of the board asks a read proxy for `…-thumb.jpg`, and a mark has to
 * be recorded against the pathname `students.photo_path` actually holds, which
 * is never the thumbnail. Without this, a thumbnail failure would be marked
 * against a pathname no row carries, and the mark would be invisible to every
 * reader.
 */
export function fullPathname(pathname: string): string {
  const suffix = `${THUMB_SUFFIX}.jpg`;
  return pathname.endsWith(suffix)
    ? `${pathname.slice(0, -suffix.length)}.jpg`
    : pathname;
}
