import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupMarks,
  summariseMarks,
  UNATTRIBUTED,
  type AskedFor,
  type MarkRow,
} from "../src/lib/marks";

/**
 * The shaping half of the marks export, tested without a database.
 *
 * Every bug this can have that actually costs anything is a shaping bug: a
 * teacher's marks on the wrong sheet, a subject column out of order, a row with
 * no teacher silently dropped so the file does not total. None of those need a
 * connection to catch, and the query that feeds them is exercised end to end in
 * marks.test.ts.
 */

const AT = new Date("2026-08-10T04:00:00Z");

function mark(over: Partial<MarkRow> = {}): MarkRow {
  return {
    studentId: "S1",
    srNo: "1",
    name: "Aarti",
    classLabel: "8",
    rollNo: null,
    fieldKey: "fa_maths",
    fieldLabel: "Maths",
    sortOrder: 5,
    value: "18",
    firstEnteredAt: AT,
    teacherId: "T1",
    teacherName: "Sunita",
    requestId: "R1",
    ...over,
  };
}

/**
 * One line of "what was asked of whom".
 *
 * A helper rather than a literal because AskedFor now also carries the request
 * and teacher ids — the board's lines can link back to the link that asked for
 * them — and three inline literals is three places to edit next time it grows.
 */
function ask(over: Partial<AskedFor> = {}): AskedFor {
  return {
    requestId: "R1",
    teacherId: "T1",
    teacher: "Sunita",
    subject: "Maths",
    classLabel: "8",
    fieldKey: "fa_maths",
    ...over,
  };
}

describe("groupMarks", () => {
  test("gives each teacher her own sheet", () => {
    const sheets = groupMarks([
      mark({ studentId: "S1", teacherName: "Sunita" }),
      mark({ studentId: "S2", teacherName: "Hemlata", fieldKey: "fa_science", fieldLabel: "Science" }),
    ]);

    assert.deepEqual(
      sheets.map((sheet) => sheet.name),
      ["Hemlata", "Sunita"],
    );
  });

  test("keeps a mark whose request is gone, on its own sheet at the end", () => {
    // student_records.request_id has no foreign key, so this is representable.
    // Dropping it would make the file quietly fail to total.
    const sheets = groupMarks([
      mark({ studentId: "S1" }),
      mark({ studentId: "S2", teacherId: null, teacherName: null, requestId: null }),
    ]);

    assert.equal(sheets.length, 2);
    assert.equal(sheets.at(-1)!.name, UNATTRIBUTED, "it should sort last, not first");
    assert.equal(sheets.at(-1)!.rows.length, 1, "the orphan mark was dropped");
  });

  test("puts a teacher's two subjects on one row per child, in display order", () => {
    const sheet = groupMarks([
      // Deliberately supplied out of order: Science sorts after Maths.
      mark({ fieldKey: "fa_science", fieldLabel: "Science", sortOrder: 7, value: "20" }),
      mark({ fieldKey: "fa_maths", fieldLabel: "Maths", sortOrder: 5, value: "18" }),
    ])[0]!;

    assert.deepEqual(
      sheet.subjects.map((subject) => subject.key),
      ["fa_maths", "fa_science"],
      "columns must follow field_defs.sort_order, not arrival order",
    );
    assert.equal(sheet.rows.length, 1, "one child should be one row");
    assert.deepEqual(sheet.rows[0]!.marks, { fa_maths: "18", fa_science: "20" });
  });

  test("carries only the subjects that sheet actually has", () => {
    const sheets = groupMarks([
      mark({ teacherName: "Sunita", fieldKey: "fa_maths", fieldLabel: "Maths" }),
      mark({
        studentId: "S2",
        teacherName: "Hemlata",
        fieldKey: "fa_science",
        fieldLabel: "Science",
      }),
    ]);

    for (const sheet of sheets) {
      assert.equal(sheet.subjects.length, 1, `${sheet.name} got a column she never entered`);
    }
  });

  test("regroups the same rows by class without losing any", () => {
    const rows = [
      mark({ studentId: "S1", classLabel: "8", teacherName: "Sunita" }),
      mark({ studentId: "S2", classLabel: "9", teacherName: "Sunita" }),
      mark({ studentId: "S3", classLabel: "9", teacherName: "Hemlata", fieldKey: "fa_science", fieldLabel: "Science" }),
    ];

    const byClass = groupMarks(rows, "class");
    assert.deepEqual(byClass.map((sheet) => sheet.name), ["8", "9"]);

    const total = (sheets: ReturnType<typeof groupMarks>) =>
      sheets.reduce((n, sheet) => n + sheet.rows.length, 0);
    assert.equal(total(byClass), total(groupMarks(rows, "teacher")));
    // A class sheet spans teachers, so it has to say which one entered what.
    assert.deepEqual(
      byClass[1]!.rows.map((row) => row.teacher).sort(),
      ["Hemlata", "Sunita"],
    );
  });

  test("sorts a class-spanning sheet by class, then by name", () => {
    const sheet = groupMarks([
      mark({ studentId: "S1", name: "Vimla", classLabel: "8" }),
      mark({ studentId: "S2", name: "Aarti", classLabel: "9" }),
      mark({ studentId: "S3", name: "Bhavna", classLabel: "8" }),
    ])[0]!;

    assert.deepEqual(
      sheet.rows.map((row) => row.name),
      ["Bhavna", "Vimla", "Aarti"],
      "class 8 should come before class 9, alphabetical within each",
    );
  });
});

describe("summariseMarks — who has NOT sent theirs", () => {
  const rosters = new Map([
    ["8", 46],
    ["9", 40],
  ]);

  /*
   * THE BUG THIS SUITE EXISTS FOR. The first version of the board summarised
   * the stored marks and nothing else, so a teacher who had entered nothing had
   * no rows to summarise and was simply absent from the screen — indistinguish-
   * able from a teacher nobody had asked. A fixture school with one round done
   * and one untouched rendered as "1 teacher", and the board's whole purpose is
   * to answer the opposite question.
   */
  test("shows a teacher who was asked and has entered nothing", () => {
    const summary = summariseMarks(
      [mark({ teacherName: "Sunita", classLabel: "8" })],
      rosters,
      [
        ask({ teacher: "Sunita", subject: "Maths", classLabel: "8", fieldKey: "fa_maths" }),
        ask({ teacher: "Hemlata", subject: "Science", classLabel: "9", fieldKey: "fa_science" }),
      ],
    );

    assert.equal(summary.length, 2, "the teacher who sent nothing vanished");
    const hemlata = summary.find((row) => row.teacher === "Hemlata")!;
    assert.equal(hemlata.entered, 0);
    assert.equal(hemlata.onRoster, 40);
    assert.equal(hemlata.missing, 40, "her whole class is outstanding");
    assert.equal(hemlata.lastEntered, null);
  });

  /*
   * THE PHANTOM ROW, which is what a subject round used to produce.
   *
   * askedFor keyed its lines on requests.audience_label. For a class round that
   * string IS the class and everything lined up. For a SUBJECT round it is
   * "Economics — Prakash Bunkar", while the arriving marks key on the child's
   * real class — so the two keys never met. The board grew an extra line at
   * 0 / 0 labelled with the subject, and a subject teacher who had entered
   * NOTHING produced only that line: "not started", no denominator, no way to
   * see she owed eighty-six children across two classes.
   *
   * askedFor now emits one line per class the FROZEN ROSTER actually covers,
   * which is also the only thing that can describe a subject link spanning
   * several classes. These two tests are that fix, expressed as summariseMarks
   * sees it.
   */
  test("a subject link spanning two classes is two real lines, not a phantom", () => {
    const summary = summariseMarks([], rosters, [
      ask({ teacher: "Prakash", subject: "Economics", classLabel: "8", fieldKey: "fa_economics" }),
      ask({ teacher: "Prakash", subject: "Economics", classLabel: "9", fieldKey: "fa_economics" }),
    ]);

    assert.equal(summary.length, 2);
    assert.deepEqual(
      summary.map((row) => [row.classLabel, row.onRoster, row.missing]),
      [
        ["8", 46, 46],
        ["9", 40, 40],
      ],
      "she owes 86 children and the board has to be able to say so",
    );
  });

  test("a subject line reaches complete once its class is in", () => {
    // Unreachable before: onRoster fell to 0 for the phantom, and the board's
    // `complete` filter is `missing === 0 && onRoster > 0`.
    const summary = summariseMarks(
      [mark({ teacherName: "Prakash", classLabel: "9", fieldKey: "fa_economics", fieldLabel: "Economics" })],
      new Map([["9", 1]]),
      [ask({ teacher: "Prakash", subject: "Economics", classLabel: "9", fieldKey: "fa_economics" })],
    );

    assert.equal(summary.length, 1);
    assert.equal(summary[0]!.onRoster, 1);
    assert.equal(summary[0]!.missing, 0);
  });

  test("does not double-count a teacher who was asked AND has entered", () => {
    const summary = summariseMarks(
      [mark({ teacherName: "Sunita", classLabel: "8" })],
      rosters,
      [ask({ teacher: "Sunita", subject: "Maths", classLabel: "8", fieldKey: "fa_maths" })],
    );

    assert.equal(summary.length, 1, "the asked line and the entered line did not merge");
    assert.equal(summary[0]!.entered, 1);
  });

  test("still reports marks nobody was asked for", () => {
    // A round since archived, or a request deleted. The marks are real and the
    // file has to total.
    const summary = summariseMarks([mark({ teacherName: "Sunita", classLabel: "8" })], rosters, []);
    assert.equal(summary.length, 1);
    assert.equal(summary[0]!.entered, 1);
  });
});

describe("summariseMarks", () => {
  const rosters = new Map([
    ["8", 46],
    ["9", 40],
  ]);

  test("counts entered against the whole class, not against what was sent", () => {
    const [row] = summariseMarks(
      [mark({ studentId: "S1" }), mark({ studentId: "S2" })],
      rosters,
    );

    assert.equal(row!.entered, 2);
    assert.equal(row!.onRoster, 46);
    assert.equal(row!.missing, 44, "a child admitted after the link went out is still missing a mark");
  });

  test("splits one teacher's subjects and classes into their own lines", () => {
    const summary = summariseMarks(
      [
        mark({ studentId: "S1", classLabel: "8", fieldKey: "fa_maths", fieldLabel: "Maths" }),
        mark({ studentId: "S2", classLabel: "9", fieldKey: "fa_maths", fieldLabel: "Maths" }),
        mark({ studentId: "S3", classLabel: "8", fieldKey: "fa_science", fieldLabel: "Science" }),
      ],
      rosters,
    );

    assert.equal(summary.length, 3, "each subject-and-class pair is its own line");
  });

  test("does not let a duplicated row push a class past its roster", () => {
    const [row] = summariseMarks([mark({ studentId: "S1" }), mark({ studentId: "S1" })], rosters);
    assert.equal(row!.entered, 1, "the same child counted twice");
  });

  test("reports the newest entry time for the group", () => {
    const later = new Date("2026-08-12T04:00:00Z");
    const [row] = summariseMarks(
      [mark({ studentId: "S1" }), mark({ studentId: "S2", firstEnteredAt: later })],
      rosters,
    );
    assert.deepEqual(row!.lastEntered, later);
  });

  test("shows a class we hold no roster size for as zero rather than throwing", () => {
    const [row] = summariseMarks([mark({ classLabel: "12 Sci" })], rosters);
    assert.equal(row!.onRoster, 0);
    assert.equal(row!.missing, 0);
  });
});
