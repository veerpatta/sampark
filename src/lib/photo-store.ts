import { get } from "@vercel/blob";
import { thumbPathname } from "./photos";
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
  const wanted = students.filter((student) => student.photoPath);
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
    const blob = await get(candidate, { access: "private" }).catch(() => null);
    if (blob?.statusCode === 200) {
      return Buffer.from(await new Response(blob.stream).arrayBuffer());
    }
  }
  return null;
}
