import "../drizzle/env";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  createBatch,
  ensureMasterLink,
  findMasterLink,
  getBatch,
  resumeBatch,
} from "../src/lib/batches";
import { listRequests } from "../src/lib/requests";
import { resolveToken } from "../src/lib/auth/token";
import {
  ensureOfficeRecipient,
  getOfficeRecipient,
  listPickableTeachers,
  MASTER_AUDIENCE_KIND,
  OFFICE_AUDIENCE_LABEL,
  OFFICE_TEACHER_ID,
} from "../src/lib/office";
import { cleanup, createFanOutScenario, FIXTURE_PREFIX } from "./fixtures";

/**
 * The round's own link.
 *
 * THE OFFICE ROW IS A SINGLETON AND THESE TESTS DO NOT OWN IT. It is keyed on
 * one fixed id, so a test that created its own would be writing over the real
 * school's number on a database these tests share with it. ensureMasterLink
 * only READS the office, so the safe arrangement is: use the row if it is
 * already there, create a placeholder if it is not, and remove the placeholder
 * afterwards only if this file was the thing that made it.
 */
let officeWasMine = false;

async function officeExists(): Promise<void> {
  const existing = await getOfficeRecipient();
  if (existing) return;
  await ensureOfficeRecipient({ phone: "9000000001", name: "Test Office" });
  officeWasMine = true;
}

after(async () => {
  // cleanup() FIRST. Every master link this file made points at the office row
  // through requests.teacher_id, which has no cascade — deleting the office
  // before its links is a foreign-key violation at teardown, which reads like a
  // flaky test and is not one. Same lesson as the note on batches in fixtures.
  await cleanup();
  if (officeWasMine) {
    await db.delete(schema.teachers).where(eq(schema.teachers.id, OFFICE_TEACHER_ID));
  }
});

const input = (scenario: Awaited<ReturnType<typeof createFanOutScenario>>) => ({
  title: "Test master round",
  audience: { classes: scenario.groups.map((group) => group.classLabel) },
  fieldKeys: ["phone"],
  dueDate: futureDate(),
  recipientMode: "class_teacher" as const,
  createdBy: scenario.userId,
});

function futureDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

describe("the master link", () => {
  it("is minted once per round, over every group's roster", async () => {
    await officeExists();
    const scenario = await createFanOutScenario();
    const result = await createBatch(input(scenario));

    assert.equal(result.created.length, 2, "two class links");
    assert.ok(result.master, "and a master link beside them");

    // Four children across two registers — the union, not one group's share.
    assert.equal(result.master.rosterSize, 4);

    const rows = await db
      .select({ id: schema.requests.id, label: schema.requests.audienceLabel })
      .from(schema.requests)
      .where(eq(schema.requests.batchId, result.batchId));

    const masters = rows.filter((row) => row.label === OFFICE_AUDIENCE_LABEL);
    assert.equal(masters.length, 1, "exactly one, never two");
  });

  it("is not minted a second time by Resume", async () => {
    await officeExists();
    const scenario = await createFanOutScenario();
    const created = await createBatch(input(scenario));

    // Resume finds every group already done and still passes through
    // ensureMasterLink — which must find the existing row, not mint a rival.
    const resumed = await resumeBatch(created.batchId, scenario.userId);
    assert.equal(resumed.created.length, 0);
    assert.equal(
      resumed.master?.requestId,
      created.master?.requestId,
      "the same link comes back",
    );

    const all = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.audienceKind, MASTER_AUDIENCE_KIND));
    const mine = all.filter((row) => row.id === created.master?.requestId);
    assert.equal(mine.length, 1);
  });

  it("opens on its own URL, carrying both registers", async () => {
    await officeExists();
    const scenario = await createFanOutScenario();
    const result = await createBatch(input(scenario));
    assert.ok(result.master);

    const resolved = await resolveToken(result.master.token);
    assert.ok(resolved, "the master token resolves like any other");
    assert.equal(resolved.roster.length, 4);
    assert.equal(resolved.audienceLabel, OFFICE_AUDIENCE_LABEL);
    assert.deepEqual(
      resolved.classLabels.slice().sort(),
      scenario.groups.map((group) => group.classLabel).sort(),
      "every class the round covers, so a row can say which register it is from",
    );
  });

  it("is absent from the board, and from the send queue", async () => {
    await officeExists();
    const scenario = await createFanOutScenario();
    const result = await createBatch(input(scenario));

    const board = await listRequests({ batchId: result.batchId });
    assert.equal(board.length, 2, "two groups, not three");
    assert.ok(
      board.every((row) => row.audienceKind !== MASTER_AUDIENCE_KIND),
      "nothing on the board is the master link",
    );

    const withIt = await listRequests({
      batchId: result.batchId,
      includeMaster: true,
    });
    assert.equal(withIt.length, 3, "and it is there when explicitly asked for");

    // The queue is one card per person to chase, and the office is not one.
    const detail = await getBatch(result.batchId);
    assert.equal(detail?.links.length, 2);
    assert.ok(
      detail?.links.every((link) => link.audienceKind !== MASTER_AUDIENCE_KIND),
    );
  });

  it("is refused for a subject round, which has no single question to ask", async () => {
    await officeExists();
    const scenario = await createFanOutScenario();

    // Written straight onto the batch rather than through a subject fan-out:
    // the refusal is a property of recipient_mode, and building a whole
    // timetable to reach it would test the timetable instead.
    const [batch] = await db
      .insert(schema.requestBatches)
      .values({
        title: "Test subject round",
        audience: { classes: scenario.groups.map((g) => g.classLabel) },
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "subject_teacher",
        createdBy: scenario.userId,
      })
      .returning({ id: schema.requestBatches.id });

    const master = await ensureMasterLink({
      batchId: batch!.id,
      createdBy: scenario.userId,
    });
    assert.equal(master, null);
    assert.equal(await findMasterLink(batch!.id), null);
  });
});

describe("the office as a recipient", () => {
  it("is never offered as a teacher", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const id = `${FIXTURE_PREFIX}OFF${suffix}`;

    await db.insert(schema.teachers).values({
      id,
      name: "Test Office Row",
      phone: "9000000002",
      isOffice: true,
    });

    const pickable = await listPickableTeachers();
    assert.ok(
      !pickable.some((teacher) => teacher.id === id),
      "an office row cannot be picked as a class teacher by mistap",
    );

    // The control: the same row without the flag IS offered, so the test is
    // about is_office and not about some other filter.
    await db
      .update(schema.teachers)
      .set({ isOffice: false })
      .where(eq(schema.teachers.id, id));
    const after = await listPickableTeachers();
    assert.ok(after.some((teacher) => teacher.id === id));
  });
});
