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
      // Five minutes in the browser, and `private` so nothing in between keeps
      // it. Long enough that scrolling a hundred-row students board does not
      // re-fetch every face; short enough that revoking an account matters.
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

/** Same 404 whether the session is missing, the path is junk, or the blob is gone. */
function notFound() {
  return new NextResponse(null, { status: 404 });
}
