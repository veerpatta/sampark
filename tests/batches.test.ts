import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { cleanup, createFanOutScenario } from "./fixtures";
import { db, schema } from "../src/lib/db";
import {
  createBatch,
  getBatch,
  markSent,
  previewBatch,
  resumeBatch,
} from "../src/lib/batches";

/**
 * The fan-out, against the real database.
 *
 * What a mock could not tell you: that N links really are N rows with N distinct
 * tokens and N frozen rosters, that a partial run keeps what it made, and that
 * `requests_batch_scope_idx` actually stops a second Resume from minting a
 * duplicate. Those are database facts.
 */

before(cleanup);
after(cleanup);

function futureDate(): string {
  return new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
}

async function requestsIn(batchId: string) {
  return db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.batchId, batchId));
}

async function rosterOf(requestId: string) {
  const rows = await db
    .select({ studentId: schema.requestStudents.studentId })
    .from(schema.requestStudents)
    .where(eq(schema.requestStudents.requestId, requestId));
  return rows.map((row) => row.studentId).sort();
}

describe("previewing a bulk send", () => {
  test("reports the links and children it would create, without creating any", async () => {
    const scenario = await createFanOutScenario();

    const preview = await previewBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    assert.equal(preview.plan.totals.links, 2);
    assert.equal(preview.plan.totals.students, 4);
    assert.equal(preview.plan.blocked.length, 0);
    assert.equal(preview.audienceSize, 4);

    const created = await db
      .select()
      .from(schema.requests)
      .where(
        inArray(
          schema.requests.audienceLabel,
          scenario.groups.map((g) => g.classLabel),
        ),
      );
    assert.equal(created.length, 0, "a preview must not write anything");
  });

  test("refuses a selection that covers nobody rather than sending nothing quietly", async () => {
    const scenario = await createFanOutScenario();
    await assert.rejects(
      previewBatch({
        title: "Phone check",
        audience: { classes: ["ZZTEST-NOBODY-IS-IN-THIS"] },
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "class_teacher",
        createdBy: scenario.userId,
      }),
      /no active students/i,
    );
  });

  test("an empty audience selects nobody, never everybody", async () => {
    // The dangerous default. A missing filter must narrow to zero, not widen to
    // the whole school.
    const scenario = await createFanOutScenario();
    await assert.rejects(
      previewBatch({
        title: "Phone check",
        audience: {},
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "class_teacher",
        createdBy: scenario.userId,
      }),
      /no active students/i,
    );
  });
});

describe("creating a bulk send", () => {
  test("makes one link per group, each with its own token and frozen roster", async () => {
    const scenario = await createFanOutScenario();

    const result = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    assert.equal(result.failed, null);
    assert.equal(result.created.length, 2);

    const tokens = new Set(result.created.map((row) => row.token));
    assert.equal(tokens.size, 2, "every link needs its own token");

    const rows = await requestsIn(result.batchId);
    assert.equal(rows.length, 2);

    for (const group of scenario.groups) {
      const row = rows.find((r) => r.audienceLabel === group.classLabel)!;
      assert.ok(row, `no link for ${group.classLabel}`);
      assert.equal(row.teacherId, group.teacherId);
      assert.equal(row.audienceKind, "class");
      assert.equal(row.classLabel, group.classLabel);

      // Each teacher sees her own children and nobody else's.
      assert.deepEqual(await rosterOf(row.id), [...group.studentIds].sort());
    }
  });

  test("a house-wide link carries children from several classes on one token", async () => {
    const scenario = await createFanOutScenario({
      houses: ["Rana Pratap", "Rana Pratap"],
    });

    // One teacher is in-charge of the house; both classes' children are hers.
    await db
      .update(schema.teachers)
      .set({ houses: ["Rana Pratap"] })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    const result = await createBatch({
      title: "House check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "house_incharge",
      createdBy: scenario.userId,
    });

    assert.equal(result.created.length, 1);

    const [row] = await requestsIn(result.batchId);
    assert.equal(row!.audienceKind, "house");
    assert.equal(row!.audienceLabel, "Rana Pratap");
    assert.equal(
      row!.classLabel,
      null,
      "a house link spans classes, so it claims none",
    );
    assert.deepEqual(
      await rosterOf(row!.id),
      scenario.groups.flatMap((g) => g.studentIds).sort(),
    );
  });

  test("children with no house are left out loudly, not silently", async () => {
    // A different house from the test above on purpose: class labels here are
    // fixture-scoped strings, but house names are the real four and shared, so
    // two tests claiming the same one would give it two in-charges and block it.
    const scenario = await createFanOutScenario({
      houses: ["Bappa Rawal", null],
    });
    await db
      .update(schema.teachers)
      .set({ houses: ["Bappa Rawal"] })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    const preview = await previewBatch({
      title: "House check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "house_incharge",
      createdBy: scenario.userId,
    });

    assert.equal(preview.plan.totals.students, 2);
    assert.equal(preview.plan.unassigned.length, 2);
    assert.deepEqual(
      preview.plan.unassigned.map((row) => row.studentId).sort(),
      [...scenario.groups[1]!.studentIds].sort(),
    );
  });
});

describe("resuming a partial fan-out", () => {
  test("creates only what is missing and keeps what already exists", async () => {
    const scenario = await createFanOutScenario();

    const first = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    // Stand in for "link two of two failed": drop it and resume.
    const rows = await requestsIn(first.batchId);
    const casualty = rows.find(
      (row) => row.audienceLabel === scenario.groups[1]!.classLabel,
    )!;
    const survivor = rows.find((row) => row.id !== casualty.id)!;

    await db
      .delete(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, casualty.id));
    await db.delete(schema.requests).where(eq(schema.requests.id, casualty.id));

    const resumed = await resumeBatch(first.batchId, scenario.userId);

    assert.equal(resumed.created.length, 1, "only the missing group");
    assert.equal(
      resumed.created[0]!.scope.value,
      scenario.groups[1]!.classLabel,
    );

    const after = await requestsIn(first.batchId);
    assert.equal(after.length, 2);
    assert.ok(
      after.some((row) => row.id === survivor.id),
      "the link that already worked must survive untouched",
    );
    assert.equal(
      after.find((row) => row.id === survivor.id)!.token,
      survivor.token,
      "and must keep its token — it may already have been sent",
    );
  });

  test("resuming a finished batch is a no-op, not a second set of links", async () => {
    const scenario = await createFanOutScenario();

    const first = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const again = await resumeBatch(first.batchId, scenario.userId);
    assert.equal(again.created.length, 0);
    assert.equal((await requestsIn(first.batchId)).length, 2);
  });
});

describe("the send queue", () => {
  test("tracks how many links have gone out, and lets a tick be taken back", async () => {
    const scenario = await createFanOutScenario();

    const result = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const before = await getBatch(result.batchId);
    assert.equal(before!.links.length, 2);
    assert.equal(before!.sent, 0);
    assert.ok(before!.links.every((link) => link.rosterSize === 2));

    await markSent(result.created[0]!.requestId, scenario.userId, true);
    assert.equal((await getBatch(result.batchId))!.sent, 1);

    await markSent(result.created[0]!.requestId, scenario.userId, false);
    assert.equal(
      (await getBatch(result.batchId))!.sent,
      0,
      "the tick must be reversible — opening WhatsApp is not proof she sent it",
    );
  });
});

/* ===================== remembering who the office named ==================== */

describe("filling a gap from the preview", () => {
  /**
   * The case this exists for, in the office's words: "I tried to ask Class 9 for
   * Physics marks and it was not there."
   *
   * Class 9 takes Science, not Physics — so nobody is down for Physics in
   * Class 9, the group is blocked, and until now the preview stated the problem
   * and offered nothing to do about it. Naming somebody has to work, and it has
   * to stick, or the same dropdown gets filled in every single round.
   */
  test("a named teacher is written back, so the next round already knows", async () => {
    const scenario = await createFanOutScenario();
    const [group] = scenario.groups;
    const teacherId = group!.teacherId;

    const input = {
      title: "FA1 Physics",
      audience: { classes: [group!.classLabel] },
      fieldKeys: ["fa_physics"],
      period: "2026-27/FA1",
      dueDate: futureDate(),
      recipientMode: "subject_teacher" as const,
      createdBy: scenario.userId,
    };

    // Nobody teaches Physics to this class, so it is blocked and unsendable.
    const before = await previewBatch(input);
    assert.equal(before.plan.ready.length, 0);
    assert.equal(before.plan.blocked.length, 1);
    assert.equal(before.plan.blocked[0]!.reason, "no-owner");

    const key = `subject|${before.plan.blocked[0]!.scope.value}`;
    const result = await createBatch({
      ...input,
      overrides: { [key]: { teacherId } },
      remember: true,
    });

    assert.equal(result.created.length, 1, "naming a teacher must make the link");

    const saved = await db
      .select()
      .from(schema.teacherSubjects)
      .where(eq(schema.teacherSubjects.teacherId, teacherId));
    assert.deepEqual(
      saved.map((row) => `${row.subjectKey}|${row.classLabel}`),
      [`physics|${group!.classLabel}`],
    );
    assert.equal(
      saved[0]!.assignedBy,
      "office",
      "so a later timetable re-import leaves the correction alone",
    );

    // And the whole point: asking again needs no dropdown.
    const after = await previewBatch(input);
    assert.equal(after.plan.blocked.length, 0);
    assert.equal(after.plan.ready.length, 1);
    assert.equal(after.plan.ready[0]!.teacherId, teacherId);
  });

  test("does not write anything back when she unticks it", async () => {
    const scenario = await createFanOutScenario();
    const [group] = scenario.groups;

    const input = {
      title: "FA1 Physics",
      audience: { classes: [group!.classLabel] },
      fieldKeys: ["fa_physics"],
      period: "2026-27/FA1",
      dueDate: futureDate(),
      recipientMode: "subject_teacher" as const,
      createdBy: scenario.userId,
    };
    const preview = await previewBatch(input);
    const key = `subject|${preview.plan.blocked[0]!.scope.value}`;

    await createBatch({
      ...input,
      overrides: { [key]: { teacherId: group!.teacherId } },
      remember: false,
    });

    const saved = await db
      .select()
      .from(schema.teacherSubjects)
      .where(eq(schema.teacherSubjects.teacherId, group!.teacherId));
    assert.equal(saved.length, 0, "covering one round must not rewrite the records");
  });

  test("remembers a class-teacher gap on the teacher's own row", async () => {
    // The same hole exists outside subject mode: a house with no in-charge had
    // no picker either. Naming someone there belongs in her houses array, which
    // is exactly what Settings would have written.
    // Rana Kumbha, unclaimed by the tests above: class labels are
    // fixture-scoped strings but house names are the real four and shared, so
    // two tests claiming one would give it two in-charges and block it. The
    // audience stays scoped to the fixture's own classes for the same reason —
    // the real roster has children in every house.
    const scenario = await createFanOutScenario({ houses: ["Rana Kumbha", null] });
    const [group] = scenario.groups;

    const input = {
      title: "House check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "house_incharge" as const,
      createdBy: scenario.userId,
    };
    const preview = await previewBatch(input);
    assert.equal(preview.plan.blocked[0]!.reason, "no-owner");

    await createBatch({
      ...input,
      overrides: { "house|Rana Kumbha": { teacherId: group!.teacherId } },
      remember: true,
    });

    const [teacher] = await db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.id, group!.teacherId));
    assert.ok(
      teacher!.houses.includes("Rana Kumbha"),
      "the choice belongs on her row, not only on this batch",
    );
    assert.deepEqual(
      teacher!.classes,
      [group!.classLabel],
      "and it must not disturb what she already owned",
    );
  });

  test("never removes the second name when two are already down for it", async () => {
    // Two teachers on one subject is a real state the office resolves per send.
    // Writing the winner back would silently delete the other's assignment.
    const scenario = await createFanOutScenario();
    const [first, second] = scenario.groups;

    await db.insert(schema.teacherSubjects).values([
      { teacherId: first!.teacherId, subjectKey: "physics", classLabel: first!.classLabel },
      { teacherId: second!.teacherId, subjectKey: "physics", classLabel: first!.classLabel },
    ]);

    const input = {
      title: "FA1 Physics",
      audience: { classes: [first!.classLabel] },
      fieldKeys: ["fa_physics"],
      period: "2026-27/FA1",
      dueDate: futureDate(),
      recipientMode: "subject_teacher" as const,
      createdBy: scenario.userId,
    };
    const preview = await previewBatch(input);
    assert.equal(preview.plan.blocked[0]!.reason, "many-owners");

    await createBatch({
      ...input,
      overrides: {
        [`subject|${preview.plan.blocked[0]!.scope.value}`]: {
          teacherId: first!.teacherId,
        },
      },
      remember: true,
    });

    const rows = await db
      .select()
      .from(schema.teacherSubjects)
      .where(eq(schema.teacherSubjects.classLabel, first!.classLabel));
    assert.equal(rows.length, 2, "both must still be on record");
  });
});
