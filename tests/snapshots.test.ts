import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshots, recordKey } from "../src/lib/snapshots";
import type { FieldDef, Student } from "../drizzle/schema";

/**
 * The frozen roster. Every review decision is a comparison against this, so a
 * value that silently freezes as blank asks a teacher to re-type data the school
 * already holds — which shipped once, for five of the ten verify fields.
 */

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: "s1",
    srNo: "SR1",
    admissionNo: null,
    classLabel: "Class 8",
    section: null,
    rollNo: null,
    name: "Child One",
    fatherName: "Father One",
    motherName: null,
    phone: "9111111111",
    altPhone: null,
    dob: null,
    gender: null,
    category: null,
    aadhaar: null,
    janAadhaar: null,
    village: null,
    address: null,
    busRoute: "Amet City",
    house: "Rana Pratap",
    aadhaarLast4: null,
    status: "active",
    source: "psp",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Student;

const field = (over: Partial<FieldDef>): FieldDef =>
  ({
    key: "phone",
    labelEn: "Phone",
    labelHi: "फ़ोन",
    mode: "verify",
    inputType: "tel",
    targetColumn: "phone",
    recordKind: null,
    maxValue: null,
    exactLen: 10,
    pattern: null,
    options: null,
    sortOrder: 10,
    active: true,
    ...over,
  }) as FieldDef;

describe("buildSnapshots", () => {
  it("freezes a field whose column name differs from the property name", () => {
    // father_name -> fatherName. Reading by the DATABASE name off a Drizzle row
    // returns undefined, and the snapshot freezes as blank.
    const snapshots = buildSnapshots(
      [student()],
      [field({ key: "father_name", targetColumn: "father_name" })],
      new Map(),
    );

    assert.equal(snapshots.get("s1")!.values.father_name, "Father One");
  });

  it("carries recognition context beyond the fields being asked about", () => {
    const snapshot = buildSnapshots([student()], [field({})], new Map()).get(
      "s1",
    )!;

    assert.equal(snapshot.srNo, "SR1");
    assert.equal(snapshot.house, "Rana Pratap");
    assert.equal(snapshot.route, "Amet City");
    assert.equal(snapshot.fatherName, "Father One");
    // Frozen so a house or route link, whose roster spans classes, can say which.
    assert.equal(snapshot.classLabel, "Class 8");
  });

  it("reads a period-scoped field from the prior records, not from students", () => {
    const marks = field({
      key: "fa_maths",
      targetColumn: null,
      recordKind: "fa_marks",
      inputType: "number",
    });
    const prior = new Map([[recordKey("s1", "fa_maths"), "18"]]);

    const snapshot = buildSnapshots([student()], [marks], prior).get("s1")!;
    assert.equal(snapshot.values.fa_maths, "18");
  });

  it("freezes null when nothing is held, rather than omitting the key", () => {
    const snapshot = buildSnapshots(
      [student({ motherName: null })],
      [field({ key: "mother_name", targetColumn: "mother_name" })],
      new Map(),
    ).get("s1")!;

    assert.ok("mother_name" in snapshot.values);
    assert.equal(snapshot.values.mother_name, null);
  });
});

describe("sibling phone inference", () => {
  const withPhone = student({
    id: "s1",
    name: "Elder Child",
    fatherName: "Shared Father",
    phone: "9111111111",
  });
  const without = student({
    id: "s2",
    name: "Younger Child",
    fatherName: "Shared Father",
    phone: null,
  });

  it("offers a sibling's number to the child who has none", () => {
    const snapshots = buildSnapshots([withPhone, without], [field({})], new Map());

    assert.deepEqual(snapshots.get("s2")!.siblingPhone, {
      name: "Elder Child",
      phone: "9111111111",
    });
  });

  it("never offers one to a child who already has a number", () => {
    const snapshots = buildSnapshots([withPhone, without], [field({})], new Map());
    assert.equal(snapshots.get("s1")!.siblingPhone, null);
  });

  it("matches on father's name case- and space-insensitively", () => {
    const messy = student({
      id: "s3",
      name: "Third Child",
      fatherName: "  shared   FATHER ",
      phone: null,
    });
    const snapshots = buildSnapshots([withPhone, messy], [field({})], new Map());
    assert.ok(snapshots.get("s3")!.siblingPhone);
  });

  it("offers nothing when the family's known numbers disagree", () => {
    // Which of two numbers belongs to the child who has neither is exactly the
    // question this is not allowed to guess at.
    const other = student({
      id: "s4",
      name: "Other Child",
      fatherName: "Shared Father",
      phone: "9222222222",
    });
    const snapshots = buildSnapshots(
      [withPhone, other, without],
      [field({})],
      new Map(),
    );

    assert.equal(snapshots.get("s2")!.siblingPhone, null);
  });

  it("groups nobody when the father's name is blank", () => {
    const a = student({ id: "s5", fatherName: null, phone: "9333333333" });
    const b = student({ id: "s6", fatherName: null, phone: null });
    const snapshots = buildSnapshots([a, b], [field({})], new Map());
    assert.equal(snapshots.get("s6")!.siblingPhone, null);
  });

  it("never reaches outside the roster being frozen", () => {
    // Scoped to this teacher's screen: it can only ever propose a number that
    // belongs to a child she is already looking at.
    const snapshots = buildSnapshots([without], [field({})], new Map());
    assert.equal(snapshots.get("s2")!.siblingPhone, null);
  });
});
