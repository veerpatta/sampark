import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  changeLogFor,
  cleanup,
  createScenario,
  studentById,
  submissionsFor,
  TEST_CLASS,
} from "./fixtures";
import {
  decideSubmissions,
  listPendingReview,
  recordSubmissions,
} from "../src/lib/submissions";

/**
 * The review transaction and the action-derivation that feeds it.
 *
 * Plan section 6 names these as the two places where a bug is expensive, and
 * these tests run against the real database on purpose: the guard being tested
 * is `AND review_status = 'pending'` inside a transaction, and that is not
 * something a mock can tell you the truth about.
 *
 * Every fixture is prefixed ZZTEST and torn down after. Run with `npm test`.
 */

before(cleanup);
after(cleanup);

describe("the roster snapshot", () => {
  test("freezes fields whose column name differs from the property name", async () => {
    // father_name -> fatherName. Looking the value up by the DATABASE name on a
    // Drizzle row returns undefined, and the snapshot silently freezes as blank.
    // That shipped once: five of the ten verify fields (father_name,
    // mother_name, alt_phone, jan_aadhaar, bus_route) were sent to teachers as
    // empty, asking them to re-type data the school already held.
    const { createRequest } = await import("../src/lib/requests");
    const { resolveToken } = await import("../src/lib/auth/token");
    const scenario = await createScenario();

    const created = await createRequest({
      title: "Snapshot check",
      classLabel: TEST_CLASS,
      teacherId: scenario.teacherId,
      fieldKeys: ["phone", "father_name", "mother_name"],
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      createdBy: scenario.userId,
    });

    const resolved = await resolveToken(created.token);
    const first = resolved!.roster.find(
      (row) => row.studentId === scenario.studentIds[0],
    )!;

    assert.equal(first.values.phone, "9111111111");
    assert.equal(
      first.values.father_name,
      "Test Father One",
      "father_name must be frozen from the students row, not left blank",
    );
    // mother_name genuinely is null on the fixture, so it stays null.
    assert.equal(first.values.mother_name, null);
  });

  test("a class label off the canonical list is refused before a token exists", async () => {
    // The expensive failure mode this guards: a label that matches no student
    // freezes an EMPTY roster and raises nothing, so the office sends a working
    // link to a blank screen and only finds out when the teacher says so.
    const { createRequest } = await import("../src/lib/requests");
    const scenario = await createScenario();

    await assert.rejects(
      createRequest({
        title: "Bad class",
        classLabel: "12 Sci", // the convention this codebase used to assume
        teacherId: scenario.teacherId,
        fieldKeys: ["phone"],
        dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        createdBy: scenario.userId,
      }),
      /not one of the 19 classes/,
    );
  });
});

describe("deriving the action from the frozen snapshot", () => {
  test("a value matching the snapshot is confirmed, and never queued", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    const result = await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9111111111" } }],
      null,
    );

    assert.equal(result.confirmed, 2); // phone matched, father_name untouched
    assert.equal(result.changed, 0);

    const rows = await submissionsFor(scenario.requestId);
    assert.ok(rows.every((row) => row.reviewStatus === "auto"));
    assert.ok(rows.every((row) => row.action === "confirmed"));
  });

  test("a different value becomes a pending change carrying the snapshot as old", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9222222222" } }],
      null,
    );

    const rows = await submissionsFor(scenario.requestId);
    const phone = rows.find((row) => row.fieldKey === "phone")!;

    assert.equal(phone.action, "changed");
    assert.equal(phone.reviewStatus, "pending");
    assert.equal(phone.oldValue, "9111111111");
    assert.equal(phone.newValue, "9222222222");
  });

  test("the client cannot declare its own action", async () => {
    // The payload has no 'action' field at all — it is derived server-side by
    // comparing with the snapshot. A client claiming a confirmation while
    // sending a new value still produces 'changed'.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [
        {
          studentId: first!.studentId,
          notPresent: false,
          values: { phone: "9333333333" },
        },
      ],
      null,
    );

    const rows = await submissionsFor(scenario.requestId);
    assert.equal(rows.find((row) => row.fieldKey === "phone")!.action, "changed");
  });

  test("a blank value means no change, never erase", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "" } }],
      null,
    );

    const phone = (await submissionsFor(scenario.requestId)).find(
      (row) => row.fieldKey === "phone",
    )!;

    assert.equal(phone.action, "confirmed");
    assert.equal(phone.newValue, "9111111111");
  });

  test("students outside the frozen roster are ignored, not errored", async () => {
    const scenario = await createScenario();

    const result = await recordSubmissions(
      scenario.resolved,
      [{ studentId: "SOMEONE-ELSE", values: { phone: "9444444444" } }],
      null,
    );

    assert.equal(result.recorded, 0);
    assert.equal((await submissionsFor(scenario.requestId)).length, 0);
  });

  test("an invalid value is refused server-side even though the client checks too", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await assert.rejects(
      () =>
        recordSubmissions(
          scenario.resolved,
          [{ studentId: first!.studentId, values: { phone: "12345" } }],
          null,
        ),
      /validation/i,
    );

    assert.equal((await submissionsFor(scenario.requestId)).length, 0);
  });

  test("not_present writes one flag per field and carries no new value", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    const result = await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, notPresent: true }],
      null,
    );

    assert.equal(result.notPresent, 2);
    const rows = await submissionsFor(scenario.requestId);
    assert.ok(rows.every((row) => row.action === "not_present"));
    assert.ok(rows.every((row) => row.newValue === null));
    assert.ok(rows.every((row) => row.reviewStatus === "pending"));
  });
});

describe("the approval transaction", () => {
  test("approving writes change_log and moves the master record", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9555555555" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId)).filter(
      (row) => row.reviewStatus === "pending",
    );
    assert.equal(pending.length, 1);

    const result = await decideSubmissions(
      pending.map((row) => row.id),
      "approved",
      scenario.userId,
    );

    assert.equal(result.applied, 1);
    assert.equal(result.studentsTouched, 1);

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9555555555");

    const log = await changeLogFor(pending.map((row) => row.id));
    assert.equal(log.length, 1);
    assert.equal(log[0]!.fromValue, "9111111111");
    assert.equal(log[0]!.toValue, "9555555555");
    assert.equal(log[0]!.decision, "approved");
    assert.equal(log[0]!.decidedBy, scenario.userId);
  });

  test("APPROVING TWICE IS A NO-OP — the pending guard holds", async () => {
    // The reason the guard exists: two office staff clicking at once, or one
    // impatient double-click, must not write the change or the log row twice.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9666666666" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending")
      .map((row) => row.id);

    const firstCall = await decideSubmissions(pending, "approved", scenario.userId);
    const secondCall = await decideSubmissions(pending, "approved", scenario.userId);

    assert.equal(firstCall.applied, 1);
    assert.equal(secondCall.applied, 0, "second approval must claim nothing");

    const log = await changeLogFor(pending);
    assert.equal(log.length, 1, "change_log must not gain a duplicate row");
  });

  test("rejecting logs the decision and leaves master alone", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9777777777" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending")
      .map((row) => row.id);

    const result = await decideSubmissions(pending, "rejected", scenario.userId);
    assert.equal(result.applied, 1);
    assert.equal(result.studentsTouched, 0);

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9111111111", "master must not have moved");

    const log = await changeLogFor(pending);
    assert.equal(log[0]!.decision, "rejected");
    assert.equal(log[0]!.toValue, null);
  });

  test("approving a not_present flag logs it but does not touch the student", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, notPresent: true }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending")
      .map((row) => row.id);

    const result = await decideSubmissions(pending, "approved", scenario.userId);

    assert.equal(result.applied, 2);
    assert.equal(result.studentsTouched, 0);

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9111111111");
    assert.equal(student!.status, "active");
  });

  test("an empty id list does nothing rather than approving everything", async () => {
    const result = await decideSubmissions([], "approved", "nobody");
    assert.deepEqual(result, { applied: 0, studentsTouched: 0, superseded: 0 });
  });

  test("a later answer supersedes an earlier pending one for the same field", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9888888881" } }],
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9888888882" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending" && row.fieldKey === "phone")
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());

    assert.equal(pending.length, 2);

    const newest = pending[1]!;
    const result = await decideSubmissions([newest.id], "approved", scenario.userId);

    assert.equal(result.applied, 1);
    assert.equal(result.superseded, 1);

    const after = await submissionsFor(scenario.requestId);
    const older = after.find((row) => row.id === pending[0]!.id)!;
    assert.equal(older.reviewStatus, "rejected");

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9888888882", "the newest answer must win");
  });

  test("two fields on one student both land", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [
        {
          studentId: first!.studentId,
          values: { phone: "9999999991", father_name: "Changed Father" },
        },
      ],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending")
      .map((row) => row.id);

    assert.equal(pending.length, 2);
    await decideSubmissions(pending, "approved", scenario.userId);

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9999999991");
    assert.equal(student!.fatherName, "Changed Father");
  });
});

describe("a correction the teacher took back", () => {
  test("a retraction supersedes the correction it cancels", async () => {
    // She corrects a number, it sends, then she reopens the row and types the
    // original back. The retraction lands as a CONFIRMATION, which is stored
    // with review_status 'auto' and never enters the queue. Computed over
    // pending rows alone the correction was still the newest thing visible, so
    // it showed un-superseded and ticked, and approving it wrote back a value
    // she had already taken back.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9222222222" } }],
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9111111111" } }],
      null,
    );

    const queue = await listPendingReview(scenario.requestId);
    const correction = queue.find((row) => row.fieldKey === "phone")!;

    assert.equal(
      correction.superseded,
      true,
      "a later confirmation must mark the correction superseded",
    );
  });

  test("approving a retracted correction is refused, not applied", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9222222222" } }],
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9111111111" } }],
      null,
    );

    const correction = (await submissionsFor(scenario.requestId)).find(
      (row) => row.fieldKey === "phone" && row.reviewStatus === "pending",
    )!;

    // The ids arrive from a browser. A hidden checkbox is not a guard.
    const result = await decideSubmissions(
      [correction.id],
      "approved",
      scenario.userId,
    );

    assert.equal(result.applied, 0, "a stale row must not be applied");
    assert.equal(result.superseded, 1);

    const student = await studentById(first!.studentId);
    assert.equal(
      student!.phone,
      "9111111111",
      "master must still hold the value she settled on",
    );

    const after = (await submissionsFor(scenario.requestId)).find(
      (row) => row.id === correction.id,
    )!;
    assert.equal(after.reviewStatus, "rejected");

    const log = await changeLogFor([correction.id]);
    assert.equal(log[0]!.decision, "rejected");
    assert.equal(log[0]!.toValue, null);
  });

  test("approving an older row does not reject the newer one still waiting", async () => {
    // supersede() rejects every other pending row sharing a field, regardless of
    // age. Handed a stale row it would reject the very submission that replaced
    // it — losing the teacher's latest answer to a mis-tap.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9888888881" } }],
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9888888882" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending" && row.fieldKey === "phone")
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
    assert.equal(pending.length, 2);

    const result = await decideSubmissions(
      [pending[0]!.id],
      "approved",
      scenario.userId,
    );

    assert.equal(result.applied, 0);

    const after = await submissionsFor(scenario.requestId);
    assert.equal(
      after.find((row) => row.id === pending[1]!.id)!.reviewStatus,
      "pending",
      "the newest answer must survive to be reviewed",
    );

    const student = await studentById(first!.studentId);
    assert.equal(student!.phone, "9111111111", "master must not have moved");
  });
});

describe("idempotency", () => {
  test("replaying a batch writes nothing the second time", async () => {
    // The teacher on a bad signal taps send, sees nothing, taps again. Without
    // the key that is a second set of pending changes for the office to wade
    // through — and possibly two approvals of the same correction.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;
    const key = "retry-after-a-dropped-connection";

    const answers = [
      { studentId: first!.studentId, values: { phone: "9123123123" } },
    ];

    await recordSubmissions(scenario.resolved, answers, null, key);
    await recordSubmissions(scenario.resolved, answers, null, key);

    const rows = await submissionsFor(scenario.requestId);
    assert.equal(rows.length, 2, "two fields, written once — not four rows");
    assert.equal(
      rows.filter((row) => row.fieldKey === "phone").length,
      1,
      "the phone answer must exist exactly once",
    );
  });

  test("a different batch key is a genuinely new answer", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9123123123" } }],
      null,
      "first-send",
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9456456456" } }],
      null,
      "she-corrected-it-again",
    );

    const phone = (await submissionsFor(scenario.requestId)).filter(
      (row) => row.fieldKey === "phone",
    );
    assert.equal(phone.length, 2);
  });

  test("no key at all still works, and never collides", async () => {
    // Pre-Phase-5 rows have a NULL key. Postgres treats NULLs in a unique index
    // as distinct, so they must not suppress each other.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9123123123" } }],
      null,
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9123123123" } }],
      null,
      null,
    );

    const phone = (await submissionsFor(scenario.requestId)).filter(
      (row) => row.fieldKey === "phone",
    );
    assert.equal(phone.length, 2);
  });
});

describe("collect-mode fields", () => {
  test("marks land in student_records against the period, not on students", async () => {
    const scenario = await createScenario({
      fieldKeys: ["fa_maths"],
      period: "2026-27/FA1",
    });
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "18" } }],
      null,
    );

    const pending = (await submissionsFor(scenario.requestId))
      .filter((row) => row.reviewStatus === "pending")
      .map((row) => row.id);

    assert.equal(pending.length, 1);
    await decideSubmissions(pending, "approved", scenario.userId);

    const { db, schema } = await import("../src/lib/db");
    const { and, eq } = await import("drizzle-orm");
    const records = await db
      .select()
      .from(schema.studentRecords)
      .where(
        and(
          eq(schema.studentRecords.studentId, first!.studentId),
          eq(schema.studentRecords.fieldKey, "fa_maths"),
        ),
      );

    assert.equal(records.length, 1);
    assert.equal(records[0]!.value, "18");
    assert.equal(records[0]!.period, "2026-27/FA1");
  });

  test("marks over the maximum are refused", async () => {
    const scenario = await createScenario({
      fieldKeys: ["fa_maths"],
      period: "2026-27/FA1",
    });
    const [first] = scenario.resolved.roster;

    await assert.rejects(
      () =>
        recordSubmissions(
          scenario.resolved,
          [{ studentId: first!.studentId, values: { fa_maths: "30" } }],
          null,
        ),
      /validation/i,
    );
  });
});
