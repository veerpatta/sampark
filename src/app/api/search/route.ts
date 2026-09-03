import { NextResponse } from "next/server";
import { canManageSettings, requireUser, UnauthorizedError } from "@/lib/auth/session";
import { search } from "@/lib/search";

/**
 * The command palette's one call. Session-checked like every other read of
 * student data; no-store, because a search result names children.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw error;
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await search(q.slice(0, 80), canManageSettings(user.role));

  return NextResponse.json(
    { hits },
    { headers: { "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex, nofollow" } },
  );
}
