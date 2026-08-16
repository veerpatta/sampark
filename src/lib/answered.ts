import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * What "answered" means. One definition, and this file is the only one.
 *
 * WHY IT IS ITS OWN FILE AND NOT A CORNER OF requests.ts. Two reasons, and the
 * second is the load-bearing one:
 *
 *   1. Five places had independently written `rosterSize > 0 && answered >=
 *      rosterSize` — the requests board, the status board, the reminder
 *      grouping, the batch roll-up and the teacher's own page. Four agreed. The
 *      fifth expressed it differently and over a different `answered`.
 *   2. lib/auth/token.ts needs the same rule, and lib/requests.ts already
 *      imports generateToken FROM token.ts. Putting the query in requests.ts
 *      and importing it there would be a cycle. So it lives below both.
 *
 * requests.ts re-exports both of these, so existing imports keep working.
 */

/**
 * Students who have been answered for on EVERY field their request asked about.
 *
 * "ANSWERED" USED TO MEAN "HAS ANY SUBMISSION", AND THAT WAS THE BUG. A teacher
 * who filled the first of two boxes for a child had answered for that child by
 * the old rule, so a class still missing six phone numbers rendered a green
 * "46 of 46" and nobody chased it. Coverage of the whole field set is the only
 * definition that survives a partly-filled card.
 *
 * Two details that are load-bearing:
 *
 *   - not_present writes one row per field (lib/submissions.ts), so a child the
 *     teacher says is not in her class still covers everything and still
 *     counts. That is right: she answered.
 *   - the `= any(field_keys)` restriction stops a submission for a key the
 *     request no longer asks about from counting toward coverage. Nothing
 *     writes one today; a request whose field set was ever edited could.
 *
 * field_keys is text[], and array_length returns NULL rather than 0 for an
 * empty array — hence the coalesce, without which a fieldless request would
 * compare against NULL and count nobody.
 */
export function coveredStudentsQuery(requestIds: string[]) {
  return db
    .select({
      requestId: schema.submissions.requestId,
      studentId: schema.submissions.studentId,
    })
    .from(schema.submissions)
    .innerJoin(
      schema.requests,
      eq(schema.requests.id, schema.submissions.requestId),
    )
    .where(
      and(
        inArray(schema.submissions.requestId, requestIds),
        sql`${schema.submissions.fieldKey} = any(${schema.requests.fieldKeys})`,
      ),
    )
    .groupBy(
      schema.submissions.requestId,
      schema.submissions.studentId,
      schema.requests.fieldKeys,
    )
    .having(
      sql`count(distinct ${schema.submissions.fieldKey}) >= coalesce(array_length(${schema.requests.fieldKeys}, 1), 0)`,
    );
}

/**
 * Is every child on this roster answered for?
 *
 * THE ZERO GUARD IS THE WHOLE POINT. A request whose frozen roster is empty has
 * `0 >= 0` and would read as finished — a group with nobody in it reported as a
 * completed round, sorted to the bottom of the chase list and never looked at.
 * Every copy of this got that right; they simply each had to remember to.
 *
 * Takes the two counts rather than a row type so a batch roll-up — whose
 * rosterSize is a sum over its children — can ask the same question.
 */
export function isAnsweredFully(counts: {
  rosterSize: number;
  studentsAnswered: number;
}): boolean {
  return counts.rosterSize > 0 && counts.studentsAnswered >= counts.rosterSize;
}
