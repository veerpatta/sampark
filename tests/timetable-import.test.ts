import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classLabelFromTimetable,
  planTimetableImport,
  type TimetableGrid,
} from "../src/lib/timetable-import";

/**
 * Reading the school's timetable into subject assignments.
 *
 * Two things about that file do not line up with this database — teachers are
 * bare first names, and classes 11 and 12 carry a "Class " prefix — and both
 * failures are silent. A name that does not match drops a teacher's whole
 * subject out of the round with nothing on screen to say so.
 */

const teachers = [
  { id: "T20", name: "Prakash Bunkar" },
  { id: "T19", name: "Nathu Lal Khatik" },
  { id: "T10", name: "Pradhuman Singh Ashiya" },
  { id: "T18", name: "Pratik Jain" },
  { id: "T09", name: "Jainendra Singh Chouhan" },
];

/** One day, one class, a row of cells. */
const grid = (
  className: string,
  cells: ({ subject: string; teachers: string[] } | { free: true })[],
): TimetableGrid => ({ Monday: { [className]: cells } });

describe("classLabelFromTimetable", () => {
  it("passes Classes 1 to 10 through untouched — they already agree", () => {
    assert.equal(classLabelFromTimetable("Class 8"), "Class 8");
    assert.equal(classLabelFromTimetable("Class 10"), "Class 10");
  });

  it("strips the redundant prefix the senior classes carry", () => {
    assert.equal(classLabelFromTimetable("Class 11 Science"), "11 Science");
    assert.equal(classLabelFromTimetable("Class 12 Commerce"), "12 Commerce");
  });

  it("does not turn Class 8 into 8, which is not a label we know", () => {
    // A blanket strip would do exactly that, and "8" matches no student.
    assert.equal(classLabelFromTimetable("Class 8"), "Class 8");
  });

  it("returns null for anything off the nineteen", () => {
    assert.equal(classLabelFromTimetable("Class 13"), null);
    assert.equal(classLabelFromTimetable("Pre-Nursery"), null);
  });
});

describe("matching the timetable's bare first names", () => {
  it("matches an exact first name", () => {
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "Maths", teachers: ["Prakash"] }]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 1);
    assert.equal(plan.confirmed[0]!.teacherId, "T20");
    assert.equal(plan.suggested.length, 0);
  });

  it("matches a name split across two words in our records", () => {
    // "Nathulal" against "Nathu Lal Khatik" is distance 3 on the first token
    // and 0 on the first two joined. Without the joined key the Class 9/10
    // Maths and Commerce Accountancy teacher lands in "no such teacher" and
    // her subjects are never sent.
    const plan = planTimetableImport(
      grid("Class 9", [{ subject: "Maths", teachers: ["Nathulal"] }]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 1);
    assert.equal(plan.confirmed[0]!.teacherId, "T19");
    assert.equal(plan.confirmed[0]!.distance, 0);
  });

  it("SUGGESTS a near miss rather than importing it", () => {
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "English compulsory", teachers: ["Pradhyuman"] }]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 0);
    assert.equal(plan.suggested.length, 1);
    assert.equal(plan.suggested[0]!.teacherId, "T10");
    assert.equal(plan.suggested[0]!.timetableName, "Pradhyuman");
    assert.equal(plan.suggested[0]!.distance, 1);
  });

  it("suggests a two-character spelling difference too", () => {
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "Physics", teachers: ["Prateek"] }]),
      teachers,
    );
    assert.equal(plan.suggested.length, 1);
    assert.equal(plan.suggested[0]!.teacherId, "T18");
  });

  it("REPORTS a name it cannot place, and never drops it", () => {
    // The failure this whole shape exists to prevent.
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "Maths", teachers: ["Someone Else"] }]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 0);
    assert.equal(plan.suggested.length, 0);
    assert.equal(plan.unmatchedTeachers.length, 1);
    assert.equal(plan.unmatchedTeachers[0]!.timetableName, "Someone Else");
    assert.deepEqual(plan.unmatchedTeachers[0]!.subjects, ["Maths"]);
    assert.deepEqual(plan.unmatchedTeachers[0]!.classLabels, ["Class 8"]);
  });
});

describe("what the importer leaves out", () => {
  it("drops the periods that are not subjects", () => {
    const plan = planTimetableImport(
      grid("Class 3", [
        { subject: "ELGA", teachers: ["Prakash", "Nathulal"] },
        { subject: "Sports", teachers: ["Prakash"] },
        { free: true },
      ]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 0);
    assert.equal(plan.suggested.length, 0);
    assert.equal(plan.unmatchedTeachers.length, 0);
    assert.equal(plan.skippedSubjects.length, 0);
  });

  it("reports a subject it has never seen instead of ignoring it", () => {
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "Astrophysics", teachers: ["Prakash"] }]),
      teachers,
    );
    assert.deepEqual(plan.skippedSubjects, ["Astrophysics"]);
    assert.equal(plan.confirmed.length, 0);
  });

  it("reports a class label that is not one of ours", () => {
    const plan = planTimetableImport(
      grid("Class 13", [{ subject: "Maths", teachers: ["Prakash"] }]),
      teachers,
    );
    assert.deepEqual(plan.unknownClasses, ["Class 13"]);
  });
});

describe("the shape of what comes out", () => {
  it("records a triple once however many periods it appears in", () => {
    // The timetable says "Jainendra teaches Class 9 Hindi" thirty times a week.
    const plan = planTimetableImport(
      {
        Monday: {
          "Class 9": [
            { subject: "Hindi", teachers: ["Jainendra"] },
            { subject: "Hindi", teachers: ["Jainendra"] },
          ],
        },
        Tuesday: {
          "Class 9": [{ subject: "Hindi", teachers: ["Jainendra"] }],
        },
      },
      teachers,
    );
    assert.equal(plan.confirmed.length, 1);
  });

  it("keeps one row per class for a subject taught to several", () => {
    const plan = planTimetableImport(
      {
        Monday: {
          "Class 9": [{ subject: "Hindi", teachers: ["Jainendra"] }],
          "Class 11 Science": [{ subject: "Hindi", teachers: ["Jainendra"] }],
        },
      },
      teachers,
    );
    assert.deepEqual(
      plan.confirmed.map((a) => a.classLabel).sort(),
      ["11 Science", "Class 9"],
    );
  });

  it("records both names on a co-taught academic period", () => {
    const plan = planTimetableImport(
      grid("Class 8", [{ subject: "Maths", teachers: ["Prakash", "Nathulal"] }]),
      teachers,
    );
    assert.equal(plan.confirmed.length, 2);
  });
});
