import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  changeLogFor,
  cleanup,
  createScenario,
  recordsFor,
  studentById,
  submissionsFor,
} from "./fixtures";
import { listPendingReview, recordSubmissions } from "../src/lib/submissions";
import {
  collectedMarks,
  groupMarks,
  listMarksPeriods,
  summariseMarks,
} from "../src/lib/marks";

/**
 * Marks go into the record without anyone approving them.
 *
 * This is the half of the submit path that has no second chance. A master-field
 * correction sits in /review until a person looks at it, so a bug there is
 * caught by the person; a mark is written the moment she taps send, and if it
 * lands in the wrong place or not at all there is nothing between that and the
 * report card. Against the real database on purpose — the guarantees being
 * tested are an upsert, a unique index and a batch, and a mock cannot tell you
 * the truth about any of them.
 */

before(cleanup);
after(cleanup);

const MARKS = { fieldKeys: ["fa_maths"], period: "2026-27/FA1" };

describe("a mark is recorded at submit, not at review", () => {
  test("lands in student_records straight away and never queues", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "18" } }],
      null,
    );

    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1, "the mark should be stored, with nobody approving it");
    assert.equal(records[0]!.value, "18");
    assert.equal(records[0]!.period, "2026-27/FA1");
    assert.equal(
      records[0]!.requestId,
      scenario.requestId,
      "the record must point back at the request, which is the only thing naming the teacher",
    );

    const queued = await listPendingReview(scenario.requestId);
    assert.deepEqual(queued, [], "a mark must never reach the review queue");
  });

  test("is marked 'applied', which is not 'auto' and not 'pending'", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "20" } }],
      null,
    );

    const [submission] = await submissionsFor(scenario.requestId);
    // 'auto' would say she confirmed something already right; 'pending' would
    // say a human still has to look. Neither is what happened.
    assert.equal(submission!.reviewStatus, "applied");
    assert.equal(submission!.action, "changed");
  });

  // The premise widened when the office gained a direct edit on /students/[id]:
  // a change_log row now means a named user decided something OR typed it. A
  // mark is still neither — it is written the moment the teacher submits, with
  // no user in the loop at all — so this stays exactly as true as it was.
  test("writes no change_log row, because nobody decided anything", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "15" } }],
      null,
    );

    const submissions = await submissionsFor(scenario.requestId);
    const log = await changeLogFor(submissions.map((row) => row.id));
    assert.deepEqual(
      log,
      [],
      "a change_log row asserts a named user decided or typed something, and none did",
    );
  });

  test("leaves the students table alone", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;
    const before = await studentById(first!.studentId);

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "22" } }],
      null,
    );

    const after = await studentById(first!.studentId);
    assert.equal(after!.phone, before!.phone);
    assert.deepEqual(after!.updatedAt, before!.updatedAt, "master data must not have moved");
  });
});

describe("master data is untouched by any of this", () => {
  test("a phone correction still queues and still needs approving", async () => {
    const scenario = await createScenario({ fieldKeys: ["phone"] });
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9222222222" } }],
      null,
    );

    const queued = await listPendingReview(scenario.requestId);
    assert.equal(queued.length, 1, "the whole point of the review gate");
    assert.equal((await studentById(first!.studentId))!.phone, "9111111111");
  });

  test("one payload carrying both takes both paths at once", async () => {
    const scenario = await createScenario({
      fieldKeys: ["phone", "fa_maths"],
      period: "2026-27/FA1",
    });
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [
        {
          studentId: first!.studentId,
          values: { phone: "9333333333", fa_maths: "19" },
        },
      ],
      null,
    );

    const queued = await listPendingReview(scenario.requestId);
    assert.deepEqual(
      queued.map((item) => item.fieldKey),
      ["phone"],
      "the mark should have gone straight in and the phone should not",
    );

    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.value, "19");
    assert.equal(
      (await studentById(first!.studentId))!.phone,
      "9111111111",
      "the phone must not move until somebody approves it",
    );
  });
});

describe("corrections and repeats", () => {
  test("a corrected mark overwrites rather than adding a second", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "12" } }],
      null,
    );
    // She re-opens the link and fixes it before the round closes.
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "21" } }],
      null,
    );

    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1, "the unique index should have collapsed these");
    assert.equal(records[0]!.value, "21");

    // What she first typed is not lost: submissions is append-only.
    const submissions = await submissionsFor(scenario.requestId);
    assert.deepEqual(
      submissions.map((row) => row.newValue).sort(),
      ["12", "21"],
      "the earlier answer must survive in the append-only table",
    );
  });

  test("the same student twice in one payload does not blow up the upsert", async () => {
    // Postgres refuses an ON CONFLICT DO UPDATE that touches one row twice in a
    // single statement, and parseAnswers does not dedupe — a stale tab can send
    // this. Without the guard in recordSubmissions this throws.
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [
        { studentId: first!.studentId, values: { fa_maths: "10" } },
        { studentId: first!.studentId, values: { fa_maths: "11" } },
      ],
      null,
    );

    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.value, "11", "last one wins");
  });

  test("a replayed batch leaves one submission and one record", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;
    const answers = [{ studentId: first!.studentId, values: { fa_maths: "17" } }];

    // A bad signal: she taps send, sees nothing, taps again.
    await recordSubmissions(scenario.resolved, answers, null, "replay-key");
    await recordSubmissions(scenario.resolved, answers, null, "replay-key");

    assert.equal((await submissionsFor(scenario.requestId)).length, 1);
    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.value, "17");
  });

  test("confirming a prefilled mark writes nothing and keeps the attribution", async () => {
    const first = await createScenario(MARKS);
    const [child] = first.resolved.roster;

    await recordSubmissions(
      first.resolved,
      [{ studentId: child!.studentId, values: { fa_maths: "16" } }],
      null,
    );

    // A second round over the same period, where she is shown the mark and
    // leaves it alone. The snapshot has to carry it for that to be a
    // confirmation rather than a fresh answer.
    const resolved = {
      ...first.resolved,
      roster: first.resolved.roster.map((row) => ({
        ...row,
        values: { ...row.values, fa_maths: "16" },
      })),
    };
    await recordSubmissions(
      resolved,
      [{ studentId: child!.studentId, values: { fa_maths: "16" } }],
      null,
    );

    const records = await recordsFor(child!.studentId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.value, "16");

    const statuses = (await submissionsFor(first.requestId)).map(
      (row) => row.reviewStatus,
    );
    assert.ok(
      statuses.includes("auto"),
      "a confirmed mark is 'auto' — there was nothing to apply",
    );
  });
});

describe("the edges", () => {
  test("'not in this class' records no mark and still asks a human", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, notPresent: true }],
      null,
    );

    assert.deepEqual(await recordsFor(first!.studentId), []);
    const queued = await listPendingReview(scenario.requestId);
    assert.equal(
      queued.length,
      1,
      "a roster error is exactly the thing the office does have to see",
    );
    assert.equal(queued[0]!.action, "not_present");
  });

  test("'not in this class' does not wipe a mark somebody already entered", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "23" } }],
      null,
    );
    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, notPresent: true }],
      null,
    );

    const records = await recordsFor(first!.studentId);
    assert.equal(records.length, 1, "a claim about the roster must not delete a mark");
    assert.equal(records[0]!.value, "23");
  });

  test("a marks request with no period keeps the answer instead of losing it", async () => {
    // resolvePeriod makes this unreachable through createRequest. The fixture
    // inserts directly, which is the only way to build the illegal state — and
    // the failure being guarded against is the worst kind: a 201 and the work
    // gone, with nothing anywhere to show it arrived.
    const scenario = await createScenario({
      fieldKeys: ["fa_maths"],
      period: null,
    });
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "14" } }],
      null,
    );

    assert.deepEqual(
      await recordsFor(first!.studentId),
      [],
      "there is no period to file it under",
    );
    const queued = await listPendingReview(scenario.requestId);
    assert.equal(queued.length, 1, "so it must queue, where a person will find it");
    assert.equal(queued[0]!.newValue, "14");
  });

  test("a mark over the maximum never reaches the record", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await assert.rejects(() =>
      recordSubmissions(
        scenario.resolved,
        [{ studentId: first!.studentId, values: { fa_maths: "30" } }],
        null,
      ),
    );

    assert.deepEqual(
      await recordsFor(first!.studentId),
      [],
      "validation runs before anything is written, not after",
    );
  });
});

/**
 * Reading a round back out.
 *
 * The board and the export are the only screens a marks round has now, so the
 * queries behind them are load-bearing in a way they would not be if /review
 * still showed the same facts. These run the real joins — in particular the two
 * LEFT joins that decide whether a mark with a dead request_id is reported or
 * silently missing from the file.
 */
describe("the board and the export read it back", () => {
  test("the period, the teacher and the mark all come back out", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "18" } }],
      null,
    );

    const periods = await listMarksPeriods();
    assert.ok(
      periods.some((row) => row.period === "2026-27/FA1"),
      "the period picker would have nothing to offer",
    );

    const marks = (await collectedMarks("2026-27/FA1")).filter(
      (row) => row.studentId === first!.studentId,
    );
    assert.equal(marks.length, 1);
    assert.equal(marks[0]!.value, "18");
    assert.equal(marks[0]!.fieldLabel, "FA Maths");
    assert.equal(
      marks[0]!.teacherName,
      "Test Teacher",
      "attribution runs request_id -> requests.teacher_id, and it is the whole point of the export",
    );
    assert.equal(marks[0]!.teacherId, scenario.teacherId);
  });

  test("a mark whose request is gone still comes back, unattributed", async () => {
    // request_id has no foreign key, so this state is representable — and an
    // inner join here would answer "which marks do we hold" by leaving some out.
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;
    const { db, schema } = await import("../src/lib/db");
    const { eq } = await import("drizzle-orm");

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "13" } }],
      null,
    );
    await db
      .update(schema.studentRecords)
      .set({ requestId: null })
      .where(eq(schema.studentRecords.studentId, first!.studentId));

    const marks = (await collectedMarks("2026-27/FA1")).filter(
      (row) => row.studentId === first!.studentId,
    );
    assert.equal(marks.length, 1, "the mark vanished from the report");
    assert.equal(marks[0]!.value, "13");
    assert.equal(marks[0]!.teacherName, null);

    const sheets = groupMarks(marks);
    assert.equal(sheets[0]!.name, "Unattributed");
  });

  test("the summary counts this teacher's marks against the real class size", async () => {
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "25" } }],
      null,
    );

    const marks = (await collectedMarks("2026-27/FA1")).filter(
      (row) => row.studentId === first!.studentId,
    );
    const { countByClass } = await import("../src/lib/students");
    const [row] = summariseMarks(marks, await countByClass());

    assert.equal(row!.teacher, "Test Teacher");
    assert.equal(row!.subject, "FA Maths");
    assert.equal(row!.entered, 1);
    assert.ok(row!.onRoster >= 2, "the fixture puts two children in the class");
    assert.ok(row!.missing >= 1, "the second child has no mark yet");
  });

  test("an ad-hoc answer is not a mark and stays off the board", async () => {
    // Ad-hoc answers share student_records and the auto-apply path, but they
    // are filed under ask/<id> and are not part of a marks round.
    const scenario = await createScenario(MARKS);
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { fa_maths: "19" } }],
      null,
    );

    const periods = await listMarksPeriods();
    assert.ok(
      !periods.some((row) => row.period.startsWith("ask/")),
      "a one-off question is not a period anyone should be offered",
    );
  });
});
