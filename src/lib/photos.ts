/**
 * Everything that knows the shape of a photo's blob pathname.
 *
 * NO NODE IMPORTS IN HERE. `validateField` calls isPhotoPathname, and
 * validateField runs on the teacher's phone as well as on the server — one
 * `node:crypto` import at the top of this file put a polyfill of it into the
 * bundle a cheap Android downloads over 3G. Web Crypto is in every browser and
 * in Node, so the randomness needs no such import.
 *
 * A photo travels through this app as ONE STRING — the pathname of a private
 * Vercel Blob — and that string is a submission value like any other. It rides
 * the whole existing pipeline (frozen snapshot → diff → review queue → master
 * record → value_sources) without a single branch outside the three places that
 * genuinely cannot be generic: the input widget, the review renderer, and the
 * upload side channel.
 *
 * WHY A PATHNAME AND NOT A URL. A private blob has no durable public URL, and a
 * public one would be a live credential frozen forever in an append-only table.
 * `submissions` cannot be edited or deleted by the app role, so anything stored
 * there is stored permanently — a pathname is the only form of this value that
 * is safe to keep for ever.
 *
 * THE VALIDATION IN HERE IS A SECURITY CONTROL, NOT A FORMAT PREFERENCE. It is
 * deliberately NOT expressed as `field_defs.pattern`, which the owner can edit
 * from /settings/fields: a regex that stops one teacher attaching another
 * child's photograph to a row must not be a value in a table.
 */

/** A student id as it can appear in a pathname. Real ones are 'S1001', 'TMP-7'. */
const STUDENT_ID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * The whole pathname, anchored.
 *
 * `students/<id>/<YYYYMMDD>-<24 hex><-thumb?>.jpg`
 *
 * Student id FIRST, so ownership is a segment comparison rather than a string
 * search, and so a per-student `list({ prefix })` is possible if a clean-up
 * tool is ever wanted. The date is there for a human reading the store; the 12
 * random bytes are what make the pathname unguessable.
 */
const PATHNAME = /^students\/([A-Za-z0-9_-]{1,32})\/\d{8}-[0-9a-f]{24}(-thumb)?\.jpg$/;

/** The 96px variant, derived by convention rather than by a second column. */
export const THUMB_SUFFIX = "-thumb";

export function isPhotoPathname(value: unknown): value is string {
  return typeof value === "string" && PATHNAME.test(value);
}

/**
 * Does this pathname belong to this student?
 *
 * SEGMENT COMPARISON, NOT `startsWith`. `students/S1001x/...`.startsWith(
 * "students/S1001") is true, and that one character is a teacher attaching one
 * child's photograph to another child's record. There is a test for exactly
 * this string.
 */
export function photoBelongsTo(value: unknown, studentId: string): boolean {
  const match = typeof value === "string" ? PATHNAME.exec(value) : null;
  return match !== null && match[1] === studentId;
}

/** A fresh, unguessable pathname for one upload. Never reused, never overwritten. */
export function photoPathname(studentId: string, now = new Date()): string {
  if (!STUDENT_ID.test(studentId)) {
    // The id comes from the frozen roster, so this cannot fire in practice —
    // which is the reason to check. A '/' or a '..' arriving here by some route
    // nobody predicted would be path traversal inside the blob store, and a
    // throw is the only outcome that is not a silent write to the wrong place.
    throw new Error("Unusable student id for a photo pathname.");
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
    .format(now)
    .replace(/-/g, "");
  return `students/${studentId}/${day}-${randomHex(12)}.jpg`;
}

/** 12 bytes of Web Crypto randomness, as hex. See the note at the top. */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The thumbnail that goes up alongside a full photo, in the same request. */
export function thumbPathname(pathname: string): string {
  if (!isPhotoPathname(pathname)) {
    throw new Error("Not a photo pathname.");
  }
  return pathname.replace(/\.jpg$/, `${THUMB_SUFFIX}.jpg`);
}

/**
 * The bytes really are a JPEG.
 *
 * `file.type` is whatever the client said it was. The three-byte SOI marker is
 * what actually distinguishes a photograph from an HTML page with a .jpg name —
 * which matters because the read proxy serves these back with an image
 * content-type, and `nosniff` only helps if the type we declare is true.
 */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Anything bigger than this is not an 800px JPEG and is not being stored. */
export const MAX_PHOTO_BYTES = 1_500_000;

/** The field key the registry uses. One place, so nothing greps for a literal. */
export const PHOTO_FIELD_KEY = "photo";
