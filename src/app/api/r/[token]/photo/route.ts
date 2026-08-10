import { NextResponse } from "next/server";
import { get, put } from "@vercel/blob";
import { resolveToken } from "@/lib/auth/token";
import {
  isJpeg,
  isPhotoPathname,
  MAX_PHOTO_BYTES,
  photoBelongsTo,
  photoPathname,
  thumbPathname,
} from "@/lib/photos";
import { guard } from "../guard";

/**
 * Photographs, in and back out again, on the teacher's link.
 *
 * A SIDE CHANNEL, NOT A NEW PIPELINE. POST here stores bytes and returns a
 * pathname; that pathname then travels as an ordinary field value in the next
 * auto-flush to /api/r/[token], through the same frozen-snapshot diff, the same
 * review queue and the same approval as a phone number. Nothing about a photo
 * reaches a student record by a route the office has not approved.
 *
 * NOTHING HERE WRITES TO THE DATABASE. An upload that is never followed by a
 * submission leaves a blob nobody references and no row anywhere — which is the
 * correct outcome for a teacher who took a photo and then closed the tab.
 *
 * THE ORDER OF THE CHECKS IS THE SECURITY. Rate limit, then resolve, then does
 * this request even ask for a photo, then is this child on the frozen roster,
 * then are these bytes actually a JPEG. Every rejection is an identical 404
 * with no body, for the reason the sibling route gives.
 *
 * Living under /api/r/* is deliberate: next.config.ts already puts noindex,
 * no-referrer and no-store on that whole prefix, and tests/headers.test.ts
 * fails if it is ever dropped. A new top-level path would have been a hole.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A year. The pathname is immutable — a retake mints a new one. */
const CACHE_SECONDS = 31_536_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limited = await guard(request, token, "photos");
  if (limited) return limited;

  const resolved = await resolveToken(token);
  if (!resolved) return notFound();

  // Without this, ANY live link is a general-purpose file dropbox. A request
  // that never asked for a photograph cannot be used to store one.
  if (!resolved.fields.some((field) => field.inputType === "photo")) {
    return notFound();
  }

  const form = await request.formData().catch(() => null);
  if (!form) return notFound();

  const studentId = form.get("studentId");
  const file = form.get("file");
  if (typeof studentId !== "string" || !(file instanceof File)) {
    return notFound();
  }

  // The FROZEN roster, the same list recordSubmissions trusts — not a fresh
  // query. The scope of this token is what it was scoped to when it was sent.
  if (!resolved.roster.some((row) => row.studentId === studentId)) {
    return notFound();
  }

  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo too large." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // `file.type` is whatever the client said. The bytes are the evidence.
  if (!isJpeg(bytes)) {
    return NextResponse.json({ error: "Not a photo." }, { status: 415 });
  }

  const pathname = photoPathname(studentId);
  const thumb = form.get("thumb");

  await put(pathname, bytes, {
    access: "private",
    contentType: "image/jpeg",
    // We mint our own randomness, and a fixed regex has to be able to validate
    // what comes back. allowOverwrite stays off: a collision should throw, not
    // quietly replace a photograph.
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: CACHE_SECONDS,
  });

  // The 96px variant, drawn from the same canvas pass on the phone and sent in
  // the same request. Its absence is not fatal — the list falls back to the
  // full image — so a thumbnail that fails to arrive must not lose the photo.
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

  // The pathname, never the blob URL. The client has no use for a URL and it
  // must not end up in localStorage, in a log, or in a forwarded screenshot.
  return NextResponse.json({ pathname }, { status: 201 });
}

/**
 * Reading one back, for the teacher.
 *
 * She needs this exactly twice: when the school already holds a photo of the
 * child, and after a reload that lost her in-memory preview. Both are reads of
 * a photo of a child on the roster her token already opens, which is why the
 * roster check is the whole authorization.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limited = await guard(request, token, "photos");
  if (limited) return limited;

  const pathname = new URL(request.url).searchParams.get("p");
  if (!isPhotoPathname(pathname)) return notFound();

  const resolved = await resolveToken(token);
  if (!resolved) return notFound();

  const owner = resolved.roster.find((row) =>
    photoBelongsTo(pathname, row.studentId),
  );
  if (!owner) return notFound();

  const blob = await get(pathname, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return notFound();

  return new Response(blob.stream, {
    headers: {
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      // `private`, never `public`: whatever wins between this and the
      // no-store rule next.config.ts puts on the whole /api/r/* prefix, no
      // shared cache is allowed to keep a child's photograph. If the prefix
      // rule does win, the cost is a re-fetch, which is the safe direction.
      "cache-control": "private, max-age=300",
    },
  });
}

/** Never a body — a 404 with content is a 404 that tells you things. */
function notFound() {
  return new NextResponse(null, { status: 404 });
}
