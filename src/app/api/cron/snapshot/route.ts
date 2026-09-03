import { NextResponse } from "next/server";
import { snapshotToday } from "@/lib/data-health";

/**
 * The daily completeness snapshot. See completeness_snapshots in schema.ts.
 *
 * Vercel's cron calls this with `Authorization: Bearer <CRON_SECRET>` when the
 * project has that variable set; with it unset, nothing may call this at all —
 * a 401 rather than a snapshot on demand, because an unauthenticated endpoint
 * that writes rows is an endpoint somebody will eventually point a script at.
 *
 * Idempotent: a second call on the same day updates the day's rows. The
 * dashboard also fills a missed day on first view (ensureSnapshotToday), so a
 * cron that fires late or not at all costs nothing but the exact minute.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  const result = await snapshotToday();
  return NextResponse.json(result);
}
