import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseTeacherForScope,
  describeScope,
  ownersFor,
  partitionByScope,
} from "../src/lib/ownership";

/**
 * The generalised owner rule. tests/teachers.test.ts still covers the
 * class-shaped front door; these cover houses and routes, where the failure
 * modes are different — ownership is sparse, and several route names differ only
 * by a parenthesised suffix.
 */

const SUNITA = {
  id: "t1",
  name: "Sunita",
  classes: ["Class 8"],
  houses: ["Rana Pratap"],
  routes: ["Amet City"],
};
const MEENA = {
  id: "t2",
  name: "Meena",
  classes: ["Class 9"],
  houses: ["Rana Pratap"],
  routes: [],
};
const RAJESH = {
  id: "t3",
  name: "Rajesh",
  classes: ["Class 10"],
  houses: [],
  routes: ["Amet Railway Station (Inside)"],
};

describe("chooseTeacherForScope", () => {
  it("selects silently when exactly one teacher owns a house", () => {
    const choice = chooseTeacherForScope([SUNITA, RAJESH], {
      kind: "house",
      value: "Rana Pratap",
    });
    assert.equal(choice.kind, "one");
    assert.equal(choice.kind === "one" && choice.teacherId, "t1");
  });

  it("refuses to guess when two teachers own the same house", () => {
    const choice = chooseTeacherForScope([SUNITA, MEENA], {
      kind: "house",
      value: "Rana Pratap",
    });
    assert.equal(choice.kind, "many");
    assert.match(choice.kind === "many" ? choice.message : "", /2 teachers/);
    assert.match(choice.kind === "many" ? choice.message : "", /Rana Pratap/);
  });

  it("says nobody owns a house rather than falling back to a class teacher", () => {
    // Only 151 of 504 students have a house at all. Quietly substituting the
    // class teacher would send a house link to someone who did not expect one.
    const choice = chooseTeacherForScope([SUNITA, MEENA], {
      kind: "house",
      value: "Rana Sanga",
    });
    assert.equal(choice.kind, "none");
    assert.match(choice.kind === "none" ? choice.message : "", /No teacher/);
    assert.match(choice.kind === "none" ? choice.message : "", /Settings/);
  });

  it("matches routes exactly — a parenthesised suffix is a different route", () => {
    // "Amet Railway Station (Inside)" and "(On Road)" are two stops with two
    // sets of children. A prefix match would hand one to the other's in-charge.
    const choice = chooseTeacherForScope([RAJESH], {
      kind: "route",
      value: "Amet Railway Station (On Road)",
    });
    assert.equal(choice.kind, "none");
  });

  it("does not read a class assignment as a house assignment", () => {
    const teacher = { id: "t9", name: "Asha", classes: ["Rana Pratap"] };
    const choice = chooseTeacherForScope([teacher], {
      kind: "house",
      value: "Rana Pratap",
    });
    assert.equal(choice.kind, "none");
  });

  it("treats a teacher with no houses or routes at all as owning none", () => {
    // Every existing row has these columns defaulted to empty, and the
    // class-shaped callers pass objects without them at all.
    const legacy = { id: "t8", name: "Old Record", classes: ["Class 8"] };
    assert.equal(
      chooseTeacherForScope([legacy], { kind: "house", value: "Rana Pratap" })
        .kind,
      "none",
    );
    assert.equal(
      chooseTeacherForScope([legacy], { kind: "class", value: "Class 8" }).kind,
      "one",
    );
  });

  it("picks nobody before a scope has a value", () => {
    assert.equal(
      chooseTeacherForScope([SUNITA], { kind: "house", value: "" }).kind,
      "none",
    );
  });
});

describe("ownersFor", () => {
  it("returns everyone assigned, in the order given", () => {
    const owners = ownersFor([SUNITA, MEENA, RAJESH], {
      kind: "house",
      value: "Rana Pratap",
    });
    assert.deepEqual(
      owners.map((teacher) => teacher.id),
      ["t1", "t2"],
    );
  });
});

describe("partitionByScope", () => {
  it("puts route owners first and keeps everybody else available", () => {
    const { owners, others } = partitionByScope([SUNITA, MEENA, RAJESH], {
      kind: "route",
      value: "Amet City",
    });
    assert.deepEqual(
      owners.map((teacher) => teacher.id),
      ["t1"],
    );
    assert.deepEqual(
      others.map((teacher) => teacher.id),
      ["t2", "t3"],
    );
  });
});

describe("describeScope", () => {
  it("reads as a sentence for each kind", () => {
    assert.equal(describeScope({ kind: "class", value: "Class 8" }), "Class 8");
    assert.equal(
      describeScope({ kind: "house", value: "Rana Pratap" }),
      "Rana Pratap house",
    );
    assert.equal(
      describeScope({ kind: "route", value: "Amet City" }),
      "the Amet City route",
    );
  });
});
