import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

/* ========================================================================== */
/*                          WHAT SHE HAS ALREADY SENT                         */
/* ========================================================================== */

/** Everything one request already holds for one student. */
export type SubmittedAnswer = {
  studentId: string;
  /** Keyed by field key, exactly as a row's `values` are. */
  values: Record<string, string | null>;
  /** She said this child is not in her class. */
  notPresent: boolean;
};

/**
 * What this request has already received, per student.
 *
 * THIS IS THE HALF THE TEACHER'S PAGE NEVER HAD. resolveToken builds her roster
 * out of the frozen snapshot, which is by definition what we held BEFORE she
 * touched anything — so a teacher who photographed twelve children, closed the
 * tab and opened the link again was shown twelve empty cards with the camera
 * open. Her work was never lost; the page simply never asked for it. The only
 * memory of it was a localStorage draft, which the Finish button clears, which
 * does not exist in the browser she opens the link in the second time, and
 * which private mode never had.
 *
 * SCOPED TO ONE REQUEST, WHICH IS WHAT MAKES IT SAFE. Every row it can return
 * was written through this same token. Handing it back to the holder of that
 * token discloses nothing they did not themselves send, so this needs no
 * authorization beyond the one resolveToken has already done.
 *
 * REJECTED IS EXCLUDED. The office turned that answer down, and showing it back
 * as done would tell her a job is finished when it is not — the same lie the
 * partial/complete split exists to refuse.
 *
 * LAST WRITE WINS, folded in TypeScript rather than in a `distinct on`. A round
 * is forty-six children over one to four fields; the row count does not justify
 * the SQL, and "a correction supersedes what went before" is the rule the whole
 * surface already runs on — see the note on PendingBatch in teacher/draft.ts.
 */
export async function answersForRequest(
  requestId: string,
  fieldKeys: string[],
): Promise<Map<string, SubmittedAnswer>> {
  const answers = new Map<string, SubmittedAnswer>();
  if (fieldKeys.length === 0) return answers;

  const rows = await db
    .select({
      studentId: schema.submissions.studentId,
      fieldKey: schema.submissions.fieldKey,
      action: schema.submissions.action,
      oldValue: schema.submissions.oldValue,
      newValue: schema.submissions.newValue,
    })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.requestId, requestId),
        inArray(schema.submissions.fieldKey, fieldKeys),
        // A field the request no longer asks about is filtered above; a
        // rejected one is filtered here. Everything else — pending, auto,
        // approved, applied — is work of hers that reached the school.
        sql`${schema.submissions.reviewStatus} <> 'rejected'`,
      ),
    )
    .orderBy(asc(schema.submissions.submittedAt));

  for (const row of rows) {
    let answer = answers.get(row.studentId);
    if (!answer) {
      answer = { studentId: row.studentId, values: {}, notPresent: false };
      answers.set(row.studentId, answer);
    }

    if (row.action === "not_present" || row.action === "absent") {
      answer.notPresent = true;
      continue;
    }

    /*
     * A LATER ANSWER UN-SAYS AN EARLIER "not in my class".
     *
     * She can tap it by accident — that is why the button was removed — and
     * then correct the row. Leaving the flag set would collapse her correction
     * back into an empty card on the next reload, which is this whole bug
     * happening again by a different route.
     */
    answer.notPresent = false;
    // `confirmed` carries the old value and no new one: she told us what we
    // held was right, so what we hold is her answer.
    answer.values[row.fieldKey] = row.newValue ?? row.oldValue;
  }

  return answers;
}
