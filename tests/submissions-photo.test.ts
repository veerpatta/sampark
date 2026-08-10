import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  recordSubmissions,
  SubmissionValidationError,
} from "../src/lib/submissions";
import { photoPathname } from "../src/lib/photos";
import { cleanup, createScenario } from "./fixtures";

/**
 * A photograph reaching the wrong child's record.
 *
 * The other properties of a photo submission — confirmed, changed, the old
 * value — are the ordinary pipeline and are already covered by review.test.ts
 * for every other field type. What is NOT ordinary, and what is only possible
 * because a photo's value is a bearer-ish string minted elsewhere, is a teacher
 * putting one child's pathname on another child on the same roster. Nothing in
 * the review queue would catch it: the face shown IS a face from that class.
 *
 * These run against the real database, like every other submission test here.
 */

after(cleanup);

const photoRound = () => createScenario({ fieldKeys: ["photo"] });

async function submissionsFor(requestId: string, studentId: string) {
  return db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.requestId, requestId),
        eq(schema.submissions.studentId, studentId),
      ),
    );
}

describe("a photo submission", () => {
  it("REFUSES a pathname belonging to another child on the same roster", async () => {
    const scenario = await photoRound();
    const [first, second] = scenario.studentIds;

    // Exactly what a tampered client would send: a real, well-formed pathname
    // that this app minted — for the wrong student.
    const stolen = photoPathname(second!);

    await assert.rejects(
      () =>
        recordSubmissions(
          scenario.resolved,
          [{ studentId: first!, values: { photo: stolen } }],
          null,
          null,
        ),
      (error: unknown) => {
        assert.ok(error instanceof SubmissionValidationError);
        assert.equal(error.failures[0]?.studentId, first);
        assert.equal(error.failures[0]?.fieldKey, "photo");
        return true;
      },
    );

    // And nothing was written. A validation failure aborts the whole batch
    // before the insert, so a rejected photo cannot leave a row behind.
    assert.equal((await submissionsFor(scenario.requestId, first!)).length, 0);
  });

  it("records her own upload as a change, with nothing as the old value", async () => {
    const scenario = await photoRound();
    const [first] = scenario.studentIds;
    const mine = photoPathname(first!);

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!, values: { photo: mine } }],
      null,
      null,
    );

    const rows = await submissionsFor(scenario.requestId, first!);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, "changed");
    assert.equal(rows[0]!.newValue, mine);
    assert.equal(rows[0]!.oldValue, null);
    assert.equal(rows[0]!.reviewStatus, "pending");
  });

  it("refuses a string that is not a pathname at all", async () => {
    const scenario = await photoRound();
    const [first] = scenario.studentIds;

    await assert.rejects(
      () =>
        recordSubmissions(
          scenario.resolved,
          [{ studentId: first!, values: { photo: "../../etc/passwd" } }],
          null,
          null,
        ),
      SubmissionValidationError,
    );
  });

  it("still ignores a student who is not on the frozen roster", async () => {
    const scenario = await photoRound();

    const result = await recordSubmissions(
      scenario.resolved,
      [{ studentId: "NOBODY", values: { photo: photoPathname("NOBODY") } }],
      null,
      null,
    );

    assert.equal(result.recorded, 0);
  });
});
