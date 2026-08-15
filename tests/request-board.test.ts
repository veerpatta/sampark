import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupBoardRows,
  type RequestBatch,
  type RequestBoardRow,
} from "../src/lib/requests";

/**
 * Collapsing a fan-out into one line.
 *
 * The arithmetic here has to agree with what the round's own page shows, so it
 * is worth pinning without a database: every number on a batch line is a sum
 * over the children the caller handed in, and the failure mode is a board that
 * quietly disagrees with the screen one tap away.
 */

const AT = (iso: string) => new Date(iso);

function row(over: Partial<RequestBoardRow> = {}): RequestBoardRow {
  return {
    id: "R1",
    title: "FA1 marks",
    audienceLabel: "Class 8",
    audienceKind: "class",
    teacher: "Sunita Sharma",
    teacherId: "T1",
    dueDate: "2026-08-20",
    status: "open",
    token: "tok1",
    teacherPhone: "9990000001",
    contactPhone: null,
    fieldKeys: ["fa_maths"],
    teacherLinkToken: null,
    rosterSize: 24,
    studentsAnswered: 0,
    changesPending: 0,
    archivedAt: null,
    batchId: null,
    createdAt: AT("2026-08-10T04:00:00Z"),
    sentAt: null,
    ...over,
  };
}

function batch(over: Partial<RequestBatch> = {}): RequestBatch {
  return {
    id: "B1",
    title: "FA1 marks",
    audience: { classes: ["Class 8", "Class 9"] },
    fieldKeys: ["fa_maths"],
    period: "2026-27/FA1",
    dueDate: "2026-08-20",
    recipientMode: "class_teacher",
    createdBy: "U1",
    createdAt: AT("2026-08-10T04:00:00Z"),
    ...over,
  } as RequestBatch;
}

const ONE_BATCH = new Map([["B1", batch()]]);

describe("groupBoardRows", () => {
  it("shows a fan-out as one line carrying every child id", () => {
    const entries = groupBoardRows(
      [
        row({ id: "R1", batchId: "B1", audienceLabel: "Class 8" }),
        row({ id: "R2", batchId: "B1", audienceLabel: "Class 9" }),
        row({ id: "R3", batchId: "B1", audienceLabel: "Class 10" }),
      ],
      ONE_BATCH,
    );

    assert.equal(entries.length, 1, "the round is still three rows");
    const entry = entries[0]!;
    assert.equal(entry.kind, "batch");
    assert.equal(entry.kind === "batch" && entry.groups, 3);
    assert.deepEqual(
      entry.kind === "batch" ? entry.requestIds : [],
      ["R1", "R2", "R3"],
      "the bulk bar would act on the wrong set",
    );
  });

  it("leaves a one-off request alone", () => {
    const entries = groupBoardRows([row({ id: "R1" })], new Map());
    assert.equal(entries[0]!.kind, "single");
  });

  it("interleaves rounds and one-offs by date", () => {
    const entries = groupBoardRows(
      [
        row({ id: "new", createdAt: AT("2026-08-12T00:00:00Z") }),
        row({ id: "c1", batchId: "B1", createdAt: AT("2026-08-10T04:00:00Z") }),
        row({ id: "c2", batchId: "B1", createdAt: AT("2026-08-10T04:00:00Z") }),
        row({ id: "old", createdAt: AT("2026-08-01T00:00:00Z") }),
      ],
      ONE_BATCH,
    );

    assert.deepEqual(
      entries.map((e) => (e.kind === "batch" ? e.batchId : e.id)),
      ["new", "B1", "old"],
      "a round must sort by its own date, among everything else",
    );
  });

  it("renders a child whose round is gone as a one-off", () => {
    // requests.batch_id is ON DELETE SET NULL, so a request can outlive its
    // round. Linking to /requests/batch/<id> then would be a link to a 404.
    const entries = groupBoardRows([row({ id: "R1", batchId: "GONE" })], new Map());
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.kind, "single");
  });

  describe("the numbers", () => {
    it("sums children, and counts groups that are fully answered", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", rosterSize: 24, studentsAnswered: 24, changesPending: 2 }),
          row({ id: "R2", batchId: "B1", rosterSize: 20, studentsAnswered: 5, changesPending: 1 }),
        ],
        ONE_BATCH,
      );

      const entry = entries[0]!;
      assert.ok(entry.kind === "batch");
      assert.equal(entry.rosterSize, 44);
      assert.equal(entry.studentsAnswered, 29);
      assert.equal(entry.changesPending, 3);
      assert.equal(entry.groupsAnswered, 1, "one class is done, not two");
    });

    it("does not call an empty roster answered", () => {
      // 0 >= 0 is true, so a group nobody is in would otherwise read complete.
      const entries = groupBoardRows(
        [row({ id: "R1", batchId: "B1", rosterSize: 0, studentsAnswered: 0 })],
        ONE_BATCH,
      );
      assert.equal(entries[0]!.kind === "batch" && entries[0]!.groupsAnswered, 0);
    });

    it("counts distinct teachers, which a subject round shares", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", teacherId: "T1" }),
          row({ id: "R2", batchId: "B1", teacherId: "T1" }),
          row({ id: "R3", batchId: "B1", teacherId: "T2" }),
        ],
        ONE_BATCH,
      );
      const entry = entries[0]!;
      assert.ok(entry.kind === "batch");
      assert.equal(entry.groups, 3);
      assert.equal(entry.teachers, 2);
    });

    it("counts the links actually handed over", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", sentAt: AT("2026-08-11T00:00:00Z") }),
          row({ id: "R2", batchId: "B1", sentAt: null }),
        ],
        ONE_BATCH,
      );
      assert.equal(entries[0]!.kind === "batch" && entries[0]!.sentCount, 1);
    });
  });

  describe("the status word", () => {
    it("is closed only when every group is", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", status: "closed" }),
          row({ id: "R2", batchId: "B1", status: "closed" }),
        ],
        ONE_BATCH,
      );
      assert.equal(entries[0]!.kind === "batch" && entries[0]!.status, "closed");
    });

    it("stays open while one group is, and says how many are not", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", status: "closed" }),
          row({ id: "R2", batchId: "B1", status: "closed" }),
          row({ id: "R3", batchId: "B1", status: "open" }),
        ],
        ONE_BATCH,
      );
      const entry = entries[0]!;
      assert.ok(entry.kind === "batch");
      assert.equal(entry.status, "open");
      assert.equal(entry.closedCount, 2, "the board could not render '2/3 closed'");
      assert.equal(entry.groups, 3);
    });
  });

  describe("archiving", () => {
    it("counts only what it was given, so a swept child leaves the line", () => {
      // The caller filters; this never reaches back for a row it was not handed.
      // A 3-group round with one swept reads as 2 groups, and the round's own
      // page still lists all 3.
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", rosterSize: 24 }),
          row({ id: "R2", batchId: "B1", rosterSize: 24 }),
        ],
        ONE_BATCH,
      );
      const entry = entries[0]!;
      assert.ok(entry.kind === "batch");
      assert.equal(entry.groups, 2);
      assert.equal(entry.rosterSize, 48, "the swept child's children are not counted");
      assert.equal(entry.archivedCount, 0, "nothing archived is visible by default");
    });

    it("reports how many are archived when they are shown", () => {
      const entries = groupBoardRows(
        [
          row({ id: "R1", batchId: "B1", archivedAt: AT("2026-08-12T00:00:00Z") }),
          row({ id: "R2", batchId: "B1" }),
        ],
        ONE_BATCH,
      );
      assert.equal(entries[0]!.kind === "batch" && entries[0]!.archivedCount, 1);
    });
  });

  it("names the first few groups, so the line still says what is inside", () => {
    // Handed in reversed, which is how they really arrive: the board sorts
    // newest first and a fan-out creates its links ascending. A round that
    // reads Class 6 to Class 9 everywhere else must not read backwards here.
    const entries = groupBoardRows(
      [
        row({ id: "R4", batchId: "B1", audienceLabel: "Class 9" }),
        row({ id: "R3", batchId: "B1", audienceLabel: "Class 8" }),
        row({ id: "R2", batchId: "B1", audienceLabel: "Class 7" }),
        row({ id: "R1", batchId: "B1", audienceLabel: "Class 6" }),
      ],
      ONE_BATCH,
    );
    assert.deepEqual(
      entries[0]!.kind === "batch" ? entries[0]!.sample : [],
      ["Class 6", "Class 7", "Class 8"],
    );
  });

  it("orders groups by register, not by the timetable's spelling", () => {
    // compareClassLabels knows the nineteen real labels; anything else (a
    // house, a bus route) falls through to a locale compare.
    const entries = groupBoardRows(
      [
        row({ id: "R1", batchId: "B1", audienceLabel: "Class 10" }),
        row({ id: "R2", batchId: "B1", audienceLabel: "Class 9" }),
        row({ id: "R3", batchId: "B1", audienceLabel: "Nursery" }),
      ],
      ONE_BATCH,
    );
    assert.deepEqual(
      entries[0]!.kind === "batch" ? entries[0]!.sample : [],
      ["Nursery", "Class 9", "Class 10"],
      "'Class 10' must not sort before 'Class 9' alphabetically",
    );
  });

  it("keeps two rounds apart", () => {
    const entries = groupBoardRows(
      [
        row({ id: "R1", batchId: "B1" }),
        row({ id: "R2", batchId: "B2" }),
      ],
      new Map([
        ["B1", batch()],
        ["B2", batch({ id: "B2", title: "Phone check" })],
      ]),
    );
    assert.equal(entries.length, 2);
  });

  it("has nothing to say about an empty board", () => {
    assert.deepEqual(groupBoardRows([], new Map()), []);
  });
});
