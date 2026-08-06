import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup, createScenario, studentById } from "./fixtures";
import { decideSubmissions, recordSubmissions } from "../src/lib/submissions";
import { mayWrite, type Precedence } from "../src/lib/precedence";
import { applySourcedPlan, planSourcedImport } from "../src/lib/import-plan";

/**
 * Precedence: who is allowed to overwrite whom.
 *
 * The expensive failure this guards against has a shape: a teacher corrects a
 * parent's mobile number, the office approves it, and three weeks later someone
 * re-imports last term's PSP export and silently puts the wrong number back. It
 * would not throw, nothing would look wrong, and the first sign of trouble
 * would be a fee reminder that never arrived.
 *
 * A teacher who sees that happen once never uses the tool again, which is why
 * the rule sits in code rather than in the field_sources table where it could
 * be edited off.
 */

const precedence: Precedence = {
  owners: new Map([
    ["class_label", "fees"],
    ["phone", "psp"],
  ]),
  ranks: new Map([
    ["election", 10],
    ["fees", 20],
    ["psp", 30],
    ["office", 90],
    ["teacher", 100],
  ]),
};

const at = new Date("2026-01-01T00:00:00Z");

describe("mayWrite", () => {
  test("anyone may fill a blank", () => {
    assert.deepEqual(mayWrite("phone", "election", undefined, precedence), {
      write: true,
    });
  });

  test("an approved teacher correction is never overwritten by an import", () => {
    for (const source of ["psp", "fees", "election"]) {
      const verdict = mayWrite(
        "phone",
        source,
        { sourceKey: "teacher", sourceUpdatedAt: at },
        precedence,
      );
      assert.equal(verdict.write, false, `${source} must not overwrite a teacher`);
      assert.match(
        verdict.write ? "" : verdict.reason,
        /teacher's correction was approved/,
      );
    }
  });

  test("even the field's own owner cannot overwrite a teacher", () => {
    // psp OWNS phone. It still loses. This is the whole point.
    const verdict = mayWrite(
      "phone",
      "psp",
      { sourceKey: "teacher", sourceUpdatedAt: at },
      precedence,
    );
    assert.equal(verdict.write, false);
  });

  test("an office edit is protected the same way", () => {
    const verdict = mayWrite(
      "phone",
      "psp",
      { sourceKey: "office", sourceUpdatedAt: at },
      precedence,
    );
    assert.equal(verdict.write, false);
  });

  test("a source may always correct itself", () => {
    // Otherwise a newer export could never fix an older one's mistake.
    assert.deepEqual(
      mayWrite("phone", "psp", { sourceKey: "psp", sourceUpdatedAt: at }, precedence),
      { write: true },
    );
  });

  test("the owning source wins over a non-owner", () => {
    assert.deepEqual(
      mayWrite("phone", "psp", { sourceKey: "fees", sourceUpdatedAt: at }, precedence),
      { write: true },
    );
  });

  test("a non-owner cannot take a field its owner holds", () => {
    // The fee app is authoritative for class allocation. PSP disagrees about
    // 9 students and PSP is simply wrong about where a child sits.
    const verdict = mayWrite(
      "class_label",
      "psp",
      { sourceKey: "fees", sourceUpdatedAt: at },
      precedence,
    );
    assert.equal(verdict.write, false);
    assert.match(verdict.write ? "" : verdict.reason, /fees is authoritative/);
  });

  test("an unowned field goes to whoever wrote it first", () => {
    const verdict = mayWrite(
      "village",
      "election",
      { sourceKey: "fees", sourceUpdatedAt: at },
      precedence,
    );
    assert.equal(verdict.write, false);
  });

  test("…unless the incoming source outranks the stored one", () => {
    assert.deepEqual(
      mayWrite(
        "village",
        "psp",
        { sourceKey: "election", sourceUpdatedAt: at },
        precedence,
      ),
      { write: true },
    );
  });
});

/* ========================================================================= */

describe("re-importing after an approved teacher correction", () => {
  before(cleanup);
  after(cleanup);

  test("nothing changes", async () => {
    const scenario = await createScenario({ fieldKeys: ["phone"] });
    const [student] = scenario.resolved.roster;
    const studentId = student!.studentId;

    // The fixture holds 9111111111. A teacher says it is wrong.
    const corrected = "9222222222";
    await recordSubmissions(
      scenario.resolved,
      [{ studentId, values: { phone: corrected } }],
      null,
    );

    const { submissionsFor } = await import("./fixtures");
    const pending = (await submissionsFor(scenario.requestId)).filter(
      (row) => row.action === "changed",
    );
    assert.equal(pending.length, 1, "the correction should be waiting for review");

    // The office approves it. This is what claims the field for `teacher`.
    const decision = await decideSubmissions(
      pending.map((row) => row.id),
      "approved",
      scenario.userId,
    );
    assert.equal(decision.applied, 1);
    assert.equal((await studentById(studentId))!.phone, corrected);

    // Now somebody re-imports an OLD PSP export still carrying the old number.
    const stale = "9111111111";
    const plan = await planSourcedImport(
      "psp",
      [{ studentId, values: { phone: stale } }],
      { allowInsert: false },
    );

    assert.equal(plan.counts.update, 0, "the import must not plan an update");
    assert.equal(plan.counts.blocked, 1, "it must be reported as blocked, not silently skipped");

    const [row] = plan.rows;
    assert.equal(row!.blocked.length, 1);
    assert.equal(row!.blocked[0]!.fieldKey, "phone");
    assert.match(
      row!.blocked[0]!.blockedBy!,
      /teacher's correction was approved/,
      "the office must be told WHY, or a blocked row looks like a no-op",
    );

    // And applying it really does nothing.
    await applySourcedPlan(plan);
    assert.equal(
      (await studentById(studentId))!.phone,
      corrected,
      "the teacher's approved number must survive the re-import",
    );
  });

  test("an import still writes a field the teacher never touched", async () => {
    // The protection is per FIELD, not per student — otherwise one correction
    // would freeze a child's whole record against every future import.
    const scenario = await createScenario({ fieldKeys: ["phone"] });
    const studentId = scenario.resolved.roster[0]!.studentId;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId, values: { phone: "9333333333" } }],
      null,
    );
    const { submissionsFor } = await import("./fixtures");
    const pending = (await submissionsFor(scenario.requestId)).filter(
      (row) => row.action === "changed",
    );
    await decideSubmissions(
      pending.map((row) => row.id),
      "approved",
      scenario.userId,
    );

    const plan = await planSourcedImport(
      "psp",
      [
        {
          studentId,
          values: { phone: "9111111111", mother_name: "Test Mother Two" },
        },
      ],
      { allowInsert: false },
    );

    await applySourcedPlan(plan);
    const after = await studentById(studentId);
    assert.equal(after!.phone, "9333333333", "phone stays as the teacher left it");
    assert.equal(after!.motherName, "Test Mother Two", "mother_name still imports");
  });
});
