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
 * Fetch every photograph the workbook needs, as thumbnails.
 *
 * THUMBNAILS, NOT THE FULL IMAGES, and that is what makes this possible at all.
 * A full photo is 30-120 kB, so five hundred of them is a 15-60 MB workbook
 * nobody can email; the 96px variant is one or two kB and the same five hundred
 * come to about a megabyte. At the size a printed list shows a face, they are
 * indistinguishable.
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
 * The thumbnail, falling back to the full image.
 *
 * Photos taken before the thumbnail existed have none, and the upload route
 * treats the thumbnail as best-effort so a bad connection can drop it. Falling
 * back keeps those children in the workbook rather than silently blank.
 */
async function readPhoto(pathname: string): Promise<Buffer | null> {
  for (const candidate of [thumbPathname(pathname), pathname]) {
    const blob = await get(candidate, { access: "private" }).catch(() => null);
    if (blob?.statusCode === 200) {
      return Buffer.from(await new Response(blob.stream).arrayBuffer());
    }
  }
  return null;
}
