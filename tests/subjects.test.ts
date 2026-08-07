import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseTeacherForSubject,
  isNonAcademic,
  subjectByFieldKey,
  subjectByKey,
  subjectFromTimetable,
  SUBJECTS,
} from "../src/lib/subjects";
import { FIELD_DEFS } from "../drizzle/seed/field_defs";
import type { TeacherLike } from "../src/lib/ownership";

/**
 * The subject registry, and who teaches what.
 *
 * SUBJECTS is the single mapping between four separate vocabularies — the key
 * in teacher_subjects, the field_defs key marks land in, the timetable's own
 * spelling, and what the office and the teacher each read. A disagreement
 * between any two of them is silent: the subject simply never appears, or
 * appears and routes to nobody.
 */

const teacher = (id: string, name: string): TeacherLike => ({
  id,
  name,
  classes: [],
  houses: [],
  routes: [],
});

describe("the SUBJECTS registry", () => {
  it("has a marks field seeded for every subject", () => {
    // The silent failure this catches: a subject the fan-out can route on but
    // whose fa_* row was never seeded, so it cannot be ticked in the builder.
    const seeded = new Set(FIELD_DEFS.map((field) => field.key));
    for (const subject of SUBJECTS) {
      assert.ok(
        seeded.has(subject.fieldKey),
        `${subject.en} declares ${subject.fieldKey}, which the seed does not have`,
      );
    }
  });

  it("keeps the four field keys that already held marks", () => {
    // student_records references field_key. Renaming one orphans every mark
    // ever collected against it.
    for (const key of ["fa_maths", "fa_physics", "fa_chemistry", "fa_biology"]) {
      assert.ok(subjectByFieldKey(key), `${key} must still exist`);
    }
  });

  it("has no duplicate keys or field keys", () => {
    assert.equal(new Set(SUBJECTS.map((s) => s.key)).size, SUBJECTS.length);
    assert.equal(new Set(SUBJECTS.map((s) => s.fieldKey)).size, SUBJECTS.length);
  });

  it("gives every subject a Hindi name, because the teacher's screen is Hindi", () => {
    for (const subject of SUBJECTS) {
      assert.ok(subject.hi.trim(), `${subject.en} has no Hindi label`);
      assert.notEqual(subject.hi, subject.en);
    }
  });
});

describe("reading the timetable's vocabulary", () => {
  it("maps the timetable's own spelling onto our key", () => {
    assert.equal(subjectFromTimetable("English compulsory")?.key, "english");
    assert.equal(subjectFromTimetable("SST")?.key, "sst");
    assert.equal(subjectFromTimetable("Maths")?.key, "maths");
  });

  it("ignores case and stray whitespace, which a hand-edited file will have", () => {
    assert.equal(subjectFromTimetable("  english   COMPULSORY ")?.key, "english");
  });

  it("returns null for something we do not collect marks for", () => {
    assert.equal(subjectFromTimetable("Astrophysics"), null);
  });

  it("knows the periods that are not subjects", () => {
    // Listed rather than inferred: a block that quietly stops counting as
    // non-academic would put ELGA's five co-teachers into a marks round.
    for (const name of ["ELGA", "Free", "Sports", "Self Study"]) {
      assert.ok(isNonAcademic(name), `${name} should not carry marks`);
    }
    assert.equal(isNonAcademic("Maths"), false);
  });
});

describe("chooseTeacherForSubject", () => {
  const teachers = [teacher("t1", "Prakash"), teacher("t2", "Nathulal")];

  it("selects silently when exactly one person is down for it", () => {
    const choice = chooseTeacherForSubject(
      [{ teacherId: "t1", subjectKey: "maths", classLabel: "Class 8" }],
      teachers,
      "maths",
      "Class 8",
    );
    assert.equal(choice.kind, "one");
    assert.equal(choice.kind === "one" && choice.teacherId, "t1");
  });

  it("refuses to guess when two are down for the same class", () => {
    // A handover mid-year is real, and picking the first row would send a whole
    // class's marks to whoever the database happened to return first.
    const choice = chooseTeacherForSubject(
      [
        { teacherId: "t1", subjectKey: "maths", classLabel: "Class 8" },
        { teacherId: "t2", subjectKey: "maths", classLabel: "Class 8" },
      ],
      teachers,
      "maths",
      "Class 8",
    );
    assert.equal(choice.kind, "many");
    assert.match(choice.kind === "many" ? choice.message : "", /2 teachers/);
    assert.match(choice.kind === "many" ? choice.message : "", /Maths in Class 8/);
  });

  it("says nobody teaches it rather than falling back to the class teacher", () => {
    const choice = chooseTeacherForSubject([], teachers, "maths", "Class 8");
    assert.equal(choice.kind, "none");
    assert.match(choice.kind === "none" ? choice.message : "", /Nobody is down/);
    assert.match(choice.kind === "none" ? choice.message : "", /Settings/);
  });

  it("does not read one class's assignment as another's", () => {
    const choice = chooseTeacherForSubject(
      [{ teacherId: "t1", subjectKey: "maths", classLabel: "Class 8" }],
      teachers,
      "maths",
      "Class 9",
    );
    assert.equal(choice.kind, "none");
  });

  it("does not read one subject's assignment as another's", () => {
    const choice = chooseTeacherForSubject(
      [{ teacherId: "t1", subjectKey: "maths", classLabel: "Class 8" }],
      teachers,
      "physics",
      "Class 8",
    );
    assert.equal(choice.kind, "none");
  });

  it("picks nobody before a subject and class are both chosen", () => {
    assert.equal(chooseTeacherForSubject([], teachers, "", "Class 8").kind, "none");
    assert.equal(chooseTeacherForSubject([], teachers, "maths", "").kind, "none");
  });

  it("ignores an assignment for a teacher who is no longer active", () => {
    // `teachers` is the active list; a row left behind must not resolve.
    const choice = chooseTeacherForSubject(
      [{ teacherId: "gone", subjectKey: "maths", classLabel: "Class 8" }],
      teachers,
      "maths",
      "Class 8",
    );
    assert.equal(choice.kind, "none");
  });

  it("names the subject in English even though the key is a slug", () => {
    assert.equal(subjectByKey("political_science")?.en, "Political Science");
  });
});
