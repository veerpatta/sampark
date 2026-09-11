import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
 * The same question, counting answers from ANY link in the same round.
 *
 * WHY THERE ARE NOW TWO OF THESE, when the whole point of this file was that
 * there is one. Because they answer two different questions, and a round with a
 * master link needs both:
 *
 *   - coveredStudentsQuery: "what did THIS link collect." That is what an
 *     export says, and what a per-request page shows. It must not change.
 *   - coveredStudentsInRound: "does anybody still owe this." A round mints a
 *     master link over every group's roster (lib/office.ts), so when the office
 *     photographs the six children a teacher never got to, the honest answer to
 *     "is Class 8 done" is yes — and to "should we chase her" is no.
 *
 * Using the first for the second is the bug this exists to prevent: the board
 * would report a finished class as empty, and RemindAll would send nineteen
 * teachers a nudge naming children somebody already did.
 *
 * THE ROSTER JOIN IS NOT DECORATION. A master link's roster is a superset of
 * every class link's, so without restricting to the scored request's own frozen
 * roster, an office answer for a Class 9 child would count toward Class 8's
 * coverage and the class would read finished while six of its own children were
 * still blank.
 *
 * Rejected submissions count here exactly as they count in coveredStudentsQuery
 * — the two differ in scope and in nothing else, which is what makes the pair
 * readable and what tests/master-progress.test.ts pins.
 */
export function coveredStudentsInRound(requestIds: string[]) {
  // `asked` is the request being scored; `wrote` is the one the answer came
  // through. For a round with no master link they are always the same row, and
  // this returns exactly what coveredStudentsQuery returns.
  const asked = alias(schema.requests, "asked");
  const wrote = alias(schema.requests, "wrote");

  return db
    .select({
      requestId: asked.id,
      studentId: schema.submissions.studentId,
    })
    .from(schema.submissions)
    .innerJoin(wrote, eq(wrote.id, schema.submissions.requestId))
    .innerJoin(
      asked,
      // Itself, or a batch-mate. `batch_id is not null` keeps two one-off
      // requests — both with a NULL batch — from being read as the same round.
      sql`(${asked.id} = ${wrote.id} or (${asked.batchId} is not null and ${asked.batchId} = ${wrote.batchId}))`,
    )
    .innerJoin(
      schema.requestStudents,
      and(
        eq(schema.requestStudents.requestId, asked.id),
        eq(schema.requestStudents.studentId, schema.submissions.studentId),
      ),
    )
    .where(
      and(
        inArray(asked.id, requestIds),
        sql`${schema.submissions.fieldKey} = any(${asked.fieldKeys})`,
      ),
    )
    .groupBy(asked.id, schema.submissions.studentId, asked.fieldKeys)
    .having(
      sql`count(distinct ${schema.submissions.fieldKey}) >= coalesce(array_length(${asked.fieldKeys}, 1), 0)`,
    );
}

/**
 * What OTHER links in the same round already hold for this request's roster.
 *
 * THE LAST MILE OF THE MASTER LINK, and without it the feature has a hole you
 * can see from the corridor: the office photographs the six children a teacher
 * never got to, the teacher opens her link that evening, and the camera opens
 * on the same six. She takes them again. Two photographs of one child arrive in
 * the review queue and somebody has to decide which is the real one — over work
 * nobody needed to do.
 *
 * A SECOND FUNCTION RATHER THAN A WIDENING OF answersForRequest, deliberately.
 * That one means "what SHE sent", and it is what seeds her sent-state; folding
 * somebody else's work into it would make her client re-upload the office's
 * answer under her token, which is both a lie about who said it and a duplicate
 * row in an append-only table.
 *
 * IT DISCLOSES NOTHING THE TOKEN DOES NOT ALREADY OPEN. Scoped to this
 * request's own frozen roster and this request's own field keys — so a teacher
 * sees, about her own children and the fields she was asked about, a value the
 * school already holds. That is the same thing the snapshot already showed her.
 */
export async function answersFromRoundMates(
  requestId: string,
  batchId: string | null,
  fieldKeys: string[],
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  // A one-off request has no round to have mates in, and nothing to ask.
  if (!batchId || fieldKeys.length === 0) return out;

  const siblings = db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.batchId, batchId),
        sql`${schema.requests.id} <> ${requestId}`,
      ),
    );

  const mine = db
    .select({ studentId: schema.requestStudents.studentId })
    .from(schema.requestStudents)
    .where(eq(schema.requestStudents.requestId, requestId));

  const rows = await db
    .select({
      studentId: schema.submissions.studentId,
      fieldKey: schema.submissions.fieldKey,
      action: schema.submissions.action,
      newValue: schema.submissions.newValue,
      oldValue: schema.submissions.oldValue,
    })
    .from(schema.submissions)
    .where(
      and(
        inArray(schema.submissions.requestId, siblings),
        inArray(schema.submissions.studentId, mine),
        inArray(schema.submissions.fieldKey, fieldKeys),
        // The office turned this one down, so it is not something the school
        // holds — the same exclusion answersForRequest makes, for the same
        // reason: showing a rejected answer back as done is a lie.
        sql`${schema.submissions.reviewStatus} <> 'rejected'`,
      ),
    )
    .orderBy(asc(schema.submissions.submittedAt));

  // Last write wins, folded in TypeScript exactly as answersForRequest folds it.
  for (const row of rows) {
    // "Not in my class" is a statement about a roster, not a value, and it is
    // not this teacher's roster being talked about. Skipped rather than merged.
    if (row.action === "not_present" || row.action === "absent") continue;
    const held = out.get(row.studentId) ?? {};
    held[row.fieldKey] = row.action === "confirmed" ? row.oldValue : row.newValue;
    out.set(row.studentId, held);
  }

  return out;
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
