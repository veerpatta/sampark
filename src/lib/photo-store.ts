import { getBlob } from "./blob-read";
import { thumbPathname } from "./photos";
import {
  fullPathname,
  hasUsablePhoto,
  inspectPhotoBytes,
  type PhotoDefect,
} from "./photo-health";
import type { Student } from "../../drizzle/schema";

/**
 * Reading photographs back out of the blob store, in bulk.
 *
 * SERVER ONLY, AND SEPARATE FROM lib/photos.ts ON PURPOSE. That module is
 * imported by validateField, which runs on the teacher's phone, so anything
 * heavier than a regex in it ends up in the bundle a cheap Android downloads —
 * a `node:crypto` import there once cost the teacher page 130 kB. The @vercel/
 * blob SDK belongs on this side of that line.
 */

/**
 * Fetch every photograph the workbook needs, at full stored resolution.
 *
 * THE FULL IMAGE, NOT THE THUMBNAIL, AND THAT IS A REVERSAL. This used to take
 * the 96px variant on the argument that "at the size a printed list shows a
 * face, they are indistinguishable". They are not. The workbook draws a face at
 * 96px on screen, which is about an inch on paper, and an inch at 300dpi wants
 * roughly 300px of source — so a 96px thumbnail was being stretched over three
 * times its resolution and the printed list came out visibly soft. That is the
 * one thing the office wants this file for.
 *
 * The size argument was also weaker than it looked. Measured over the real
 * store: a thumbnail averages 2.5 kB and a full photo 52 kB, so ONE CLASS at
 * full resolution is about 2.3 MB — an ordinary attachment — and it is only the
 * whole-school export, which nobody prints, that reaches 25 MB.
 *
 * 800px is the ceiling and no change here can raise it: components/ui/downscale
 * resizes before upload and the 3-8 MB original is never sent, deliberately,
 * because pushing one over 2G is a minute per child. At the size the sheet
 * draws it that is still an eightfold oversample. Both doors run that same
 * module — the teacher's phone and the office replacing a photo on
 * /students/[id] — which is what keeps this assertion true of every blob in the
 * store rather than only of the ones a teacher sent.
 *
 * Concurrent, because five hundred sequential round trips to the blob store is
 * a minute of wall clock. Capped, because each one is a billable simple
 * operation and the Hobby plan's ceiling is 1,200 a minute — an unbounded fan
 * out would trip it and take the rest of the app's blob reads down with it.
 *
 * A photo that fails to fetch is simply absent from the map. One unreadable
 * blob must not cost the office the other four hundred and ninety-nine.
 */
const FETCH_CONCURRENCY = 16;

export async function fetchPhotos(students: Student[]): Promise<Map<string, Buffer>> {
  // A photograph already known not to open is not fetched at all. It would cost
  // a billable blob operation to learn what the row already says, and the
  // workbook prints "no photo" for that child either way — see
  // lib/student-export.ts, which reads the same predicate.
  const wanted = students.filter(hasUsablePhoto);
  const photos = new Map<string, Buffer>();
  if (wanted.length === 0) return photos;

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, wanted.length) },
    async () => {
      for (let i = cursor++; i < wanted.length; i = cursor++) {
        const student = wanted[i]!;
        const bytes = await readPhoto(student.photoPath!);
        if (bytes) photos.set(student.id, bytes);
      }
    },
  );
  await Promise.all(workers);
  return photos;
}

/**
 * The full image, falling back to the thumbnail.
 *
 * THE ORDER IS THE WHOLE CHANGE — it used to be the other way round. The
 * fallback is kept, and is not decoration: a blob that will not read leaves the
 * child blank on a list somebody is about to print, and a soft face is a great
 * deal better than no face. It should almost never fire, because every photo
 * has a full image by construction and only the thumbnail is best-effort.
 */
async function readPhoto(pathname: string): Promise<Buffer | null> {
  for (const candidate of [pathname, thumbPathname(pathname)]) {
    const { bytes } = await readBlob(candidate);
    if (bytes) return bytes;
  }
  return null;
}

/**
 * One blob, and a verdict on it.
 *
 * THE VERDICT IS THE POINT, and it is why this is not just a fetch. Every
 * reader before this treated "the store answered" as "there is a photograph",
 * and those are different things: an upload that lost signal halfway leaves a
 * blob that downloads perfectly and is half a face. inspectPhotoBytes is what
 * tells them apart — see lib/photo-health.ts, where it lives so that nothing
 * server-shaped has to be imported to run it.
 *
 * getBlob resolves to null for a blob that is not there and THROWS for a store
 * that would not answer, and the two are worth distinguishing: the first is a
 * child to photograph again, the second is very probably this app's own
 * credentials or the Hobby plan's blob limit, and marking five hundred children
 * for re-photographing over a bad token would be a disaster of its own. The
 * sweep in scripts/verify-photos.ts stops on a run of them for that reason.
 */
export async function readBlob(
  pathname: string,
): Promise<{ bytes: Buffer | null; defect: PhotoDefect | null }> {
  let blob;
  try {
    blob = await getBlob(pathname);
  } catch {
    return { bytes: null, defect: "unreadable" };
  }
  if (!blob) return { bytes: null, defect: "missing" };
  if (blob.statusCode !== 200) return { bytes: null, defect: "unreadable" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
  } catch {
    // The store answered and then the body did not arrive. Not the child's
    // photograph's fault, so it is 'unreadable' rather than 'missing' and the
    // sweep will ask again next time.
    return { bytes: null, defect: "unreadable" };
  }

  const defect = inspectPhotoBytes(bytes);
  return { bytes: defect === "not-an-image" ? null : bytes, defect };
}

/**
 * Is the photograph this pathname names whole, and what can be shown meanwhile?
 *
 * THE PHOTOGRAPH IS THE FULL IMAGE, ALWAYS. A thumbnail is derived, optional,
 * and documented everywhere in this app as best-effort — so a missing one is
 * not a child to photograph again, it is a fallback to the full image. The
 * reverse is not true: if the full image is gone, the school does not hold a
 * printable photograph of that child any more, and a surviving 96px square is
 * not one either. So the verdict follows the full image and the bytes follow
 * whatever can actually be drawn.
 *
 * ONE BLOB READ ON THE PATH THAT WORKS, which is nearly all of them. A board
 * row asks for a thumbnail, and if the thumbnail opens cleanly that is the end
 * of it — reading the full image as well, on every face of a hundred-row board,
 * would double the transfer this app is careful about everywhere else. A good
 * thumbnail is taken as evidence enough; the thorough pass is the sweep in
 * scripts/verify-photos.ts, which is allowed to be slow because it runs once.
 *
 * The second read only happens when what was asked for will not open, and then
 * it is worth it twice over: it is what tells a MISSING THUMBNAIL apart from a
 * missing photograph. The office's board asks for thumbnails, so before this a
 * child whose 96px variant had not arrived drew a broken square for ever while
 * a perfectly good photograph sat in the store behind it.
 */
export async function readPhotoFor(
  wanted: string,
): Promise<{ bytes: Buffer | null; defect: PhotoDefect | null }> {
  const full = fullPathname(wanted);

  const first = await readBlob(wanted);
  if (first.bytes && first.defect === null) return { bytes: first.bytes, defect: null };

  if (wanted !== full) {
    // A thumbnail is best-effort by construction and always has been. Its
    // absence is a fallback, never a verdict — the verdict is the full image's.
    const whole = await readBlob(full);
    return { bytes: whole.bytes ?? first.bytes, defect: whole.defect };
  }

  // The photograph itself is damaged or gone. The thumbnail is still worth
  // showing while the office decides what to do about the mark this leaves.
  const thumb = await readBlob(thumbPathname(full));
  return { bytes: first.bytes ?? thumb.bytes, defect: first.defect ?? "unreadable" };
}
