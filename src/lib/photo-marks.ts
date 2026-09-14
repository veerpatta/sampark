import { sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { PhotoDefect } from "./photo-health";

/**
 * Writing down that a child's photograph will not open — and taking it back.
 *
 * SEPARATE FROM lib/photo-store.ts BECAUSE THAT MODULE IS THE BLOB STORE AND
 * THIS ONE IS THE DATABASE. Two different failures, two different costs, and
 * the sweep script wants to do one without the other while it decides.
 *
 * NEITHER OF THESE IS AN EDIT TO THE CHILD'S RECORD, and that is the reason
 * they do not go through writeOfficeEdit. Nobody typed anything and nothing
 * about the child changed: this is the app noticing that a file it holds will
 * not open. So there is no change_log row, no value_sources stamp and — the one
 * that would actually mislead somebody — NO `updated_at`. That column drives
 * the "Recently updated" sort and the activity feed, and a nightly sweep that
 * touched it would push five hundred children to the top of a list the office
 * uses to see what has been worked on today.
 *
 * KEYED BY THE PATHNAME. Every statement here is scoped `where photo_path = $1`,
 * so a mark can only ever land on a row that still holds the exact photograph
 * that failed. A retake mints a new pathname (lib/photos.ts), which means a
 * sweep racing an upload cannot mark the fresh photograph: the update matches
 * nothing and the new photo stands.
 */

/**
 * Mark the photograph at this pathname as one nobody can open.
 *
 * The WHERE clause carries its own idempotence. A board with a hundred faces on
 * it asks the proxy a hundred times, and re-stamping a mark that is already
 * there would be a hundred pointless writes to a serverless database — so a row
 * that already says this is left exactly as it is, timestamp included, and the
 * "checked on" date the office reads stays the date it was actually found.
 *
 * Returns the children this touched — which is who the sweep names in its
 * report, and nobody at all when the mark was already there.
 */
export async function recordPhotoDefect(
  fullPath: string,
  defect: PhotoDefect,
): Promise<string[]> {
  return touched(await db.execute(sql`
    update ${schema.students}
       set photo_broken_path = ${fullPath},
           photo_broken_reason = ${defect},
           photo_broken_at = now()
     where photo_path = ${fullPath}
       and (photo_broken_path is distinct from ${fullPath}
            or photo_broken_reason is distinct from ${defect})
    returning id
  `));
}

/**
 * The photograph opens after all — take the mark off.
 *
 * ONLY THE SWEEP CALLS THIS, and that is not an oversight. Once a child is
 * marked, every screen draws their initials and stops asking the proxy for the
 * file at all, so the proxy is precisely the one place that will never again
 * see the photograph recover. A blob store that was briefly refusing reads —
 * an expired token, a plan limit — is exactly the case that needs taking back,
 * and scripts/verify-photos.ts is what looks.
 */
export async function clearPhotoDefect(fullPath: string): Promise<string[]> {
  return touched(await db.execute(sql`
    update ${schema.students}
       set photo_broken_path = null,
           photo_broken_reason = null,
           photo_broken_at = null
     where photo_path = ${fullPath}
       and photo_broken_path is not null
    returning id
  `));
}

/**
 * Which students an UPDATE actually changed.
 *
 * `returning id` and the length of that, rather than a driver's row count:
 * lib/ratelimit.ts already reads `.rows` off this driver, and a returned row is
 * the one shape every Postgres client agrees on.
 */
function touched(result: unknown): string[] {
  const rows = (result as { rows?: { id?: unknown }[] } | null)?.rows ?? [];
  return rows.map((row) => String(row.id));
}
