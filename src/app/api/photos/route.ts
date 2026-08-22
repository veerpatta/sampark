import { NextResponse } from "next/server";
import { get, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  canApproveIntoMaster,
  currentUser,
  requireUser,
  UnauthorizedError,
} from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  isJpeg,
  isPhotoPathname,
  MAX_PHOTO_BYTES,
  photoPathname,
  thumbPathname,
} from "@/lib/photos";
import { dbNameFor, logKeyFor, writeOfficeEdit } from "@/lib/student-edit";

/**
 * The office's way of looking at a photograph.
 *
 * A PROXY, NOT A SIGNED URL. A presigned URL is a bearer credential that keeps
 * working for its whole window no matter who ends up holding it, and it lands
 * in `<img src>`, in browser history, in a screenshot, in a log. These are
 * photographs of children. A proxy re-checks the session on every single
 * request, which is the property actually wanted, and the cost is one hop
 * through a function that is already in the same region as the store.
 *
 * The teacher surface has its OWN proxy at /api/r/[token]/photo, guarded by the
 * frozen roster instead of by a session. Two doors, two different keys, neither
 * of which opens the other's photos.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return notFound();

  const pathname = new URL(request.url).searchParams.get("p");
  // Shape-checked before it reaches the store: `p` is a query parameter, and
  // a pathname is a path. See isPhotoPathname for what it refuses.
  if (!isPhotoPathname(pathname)) return notFound();

  const blob = await get(pathname, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return notFound();

  return new Response(blob.stream, {
    headers: {
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      // A YEAR, AND IMMUTABLE, BECAUSE THE PATHNAME IS.
      //
      // A retake mints a new pathname and never overwrites — see lib/photos.ts
      // — so the bytes behind any one of these URLs can never change. Replacing
      // a child's photo changes students.photo_path, which changes the URL, so
      // there is no stale image to serve.
      //
      // This was five minutes, which meant a browser re-fetched every face on a
      // hundred-row board four times an hour. Private delivery costs a Function
      // round trip plus Blob Data Transfer plus Fast Origin Transfer plus Fast
      // Data Transfer on every miss, and the Hobby plan cuts Blob off rather
      // than billing when a limit is passed. Repeat transfer is now nil.
      //
      // `private` and not `public`: a shared cache must never hold a photograph
      // of a child, and this response is only correct for the session that
      // asked for it. The cost of the long life is that a browser which has
      // already downloaded a face keeps it after the account is revoked — which
      // is true of anything it has already been shown.
      "cache-control": "private, max-age=31536000, immutable",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

/** Same 404 whether the session is missing, the path is junk, or the blob is gone. */
function notFound() {
  return new NextResponse(null, { status: 404 });
}

/** A year. The pathname is immutable — a replacement mints a new one. */
const CACHE_SECONDS = 31_536_000;

/**
 * Replacing a child's photograph from the office console.
 *
 * THE TEACHER'S UPLOAD ROUTE DELIBERATELY WRITES NOTHING TO THE DATABASE, AND
 * THIS ONE DELIBERATELY DOES. That is the whole difference between them. Hers
 * stores bytes and hands back a pathname which then has to survive the frozen
 * roster, the review queue and an approval before it reaches a student record —
 * her upload still owes a review. The person here IS the review, so the same
 * step that stores the bytes attaches them, with a change_log row and an
 * `office` provenance stamp, exactly as a typed field edit would get.
 *
 * BYTES FIRST, DATABASE SECOND. A put that succeeds followed by a write that
 * fails leaves an unreferenced blob, which costs storage and nothing else. The
 * other order leaves students.photo_path naming bytes that were never stored,
 * which is a broken face on the roster and no way to tell why.
 *
 * The order of the checks is the security, as on the teacher route — but the
 * status codes here are honest rather than uniformly 404. That route's sameness
 * defends a bearer token against a stranger probing it; this one has already
 * authenticated a member of staff, and "too large" is worth more to her than
 * the nothing an attacker learns from it.
 */
export async function POST(request: Request) {
  // The same 401/403 split the import route uses. A layout does not protect
  // /api, so this is the guard, not a second copy of one.
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw error;
  }

  if (!canApproveIntoMaster(user.role)) {
    return NextResponse.json(
      { error: "Your role can view a photo but not replace one." },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a form." }, { status: 400 });

  const studentId = form.get("studentId");
  const file = form.get("file");
  if (typeof studentId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "Expected a student and a file." }, { status: 400 });
  }

  // The child must exist. Without this the store accumulates blobs under ids
  // nothing references — photoPathname already refuses a traversal, so this is
  // about scope rather than safety.
  const [student] = await db
    .select({ id: schema.students.id, photoPath: schema.students.photoPath })
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);
  if (!student) return NextResponse.json({ error: "No such student." }, { status: 404 });

  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo too large." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // `file.type` is whatever the browser said. The bytes are the evidence.
  if (!isJpeg(bytes)) {
    return NextResponse.json({ error: "Not a photo." }, { status: 415 });
  }

  const pathname = photoPathname(studentId);

  await put(pathname, bytes, {
    access: "private",
    contentType: "image/jpeg",
    // Our own randomness, and a fixed regex has to validate what comes back.
    // allowOverwrite stays off: a collision should throw, never quietly replace
    // a photograph.
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: CACHE_SECONDS,
  });

  // The 96px variant, from the same canvas pass in the browser. Its absence is
  // not fatal — every reader falls back to the full image — so a thumbnail that
  // fails to arrive must not lose the photograph.
  const thumb = form.get("thumb");
  if (thumb instanceof File && thumb.size > 0 && thumb.size <= MAX_PHOTO_BYTES) {
    const thumbBytes = Buffer.from(await thumb.arrayBuffer());
    if (isJpeg(thumbBytes)) {
      await put(thumbPathname(pathname), thumbBytes, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: CACHE_SECONDS,
      });
    }
  }

  const dbName = dbNameFor("photoPath");
  await writeOfficeEdit({
    studentId,
    decidedBy: user.id,
    changes: [
      {
        column: "photoPath",
        dbName,
        // 'photo', not 'photo_path' — the audit screens join field_defs on this
        // to find a label. See logKeyFor.
        logKey: logKeyFor(dbName),
        from: student.photoPath,
        toValue: pathname,
        to: pathname,
      },
    ],
  });

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/settings/audit");

  // The pathname, never the blob URL. A private blob's URL is a live credential
  // and this one would land in a fetch response the browser keeps.
  return NextResponse.json({ pathname }, { status: 201 });
}
