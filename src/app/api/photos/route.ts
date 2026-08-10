import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { currentUser } from "@/lib/auth/session";
import { isPhotoPathname } from "@/lib/photos";

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
