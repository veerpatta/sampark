import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseTeacherForClass, partitionByClass } from "../src/lib/teachers";

const SUNITA = { id: "t1", name: "Sunita", classes: ["8", "9"] };
const MEENA = { id: "t2", name: "Meena", classes: ["8"] };
const RAJESH = { id: "t3", name: "Rajesh", classes: ["10 A"] };

describe("chooseTeacherForClass", () => {
  it("selects silently when exactly one teacher owns the class", () => {
    const choice = chooseTeacherForClass([SUNITA, RAJESH], "8");
    assert.equal(choice.kind, "one");
    assert.equal(choice.kind === "one" && choice.teacherId, "t1");
  });

  it("selects nobody when two teachers own the class, and says so", () => {
    // The whole point. Picking the first one alphabetically would send the
    // link to the wrong person and nobody would find out until the due date.
    const choice = chooseTeacherForClass([SUNITA, MEENA], "8");
    assert.equal(choice.kind, "many");
    assert.equal(choice.owners.length, 2);
    assert.match(choice.kind === "many" ? choice.message : "", /2 teachers/);
    assert.match(choice.kind === "many" ? choice.message : "", /Class|8/);
  });

  it("selects nobody when the class has no teacher, and offers the list", () => {
    const choice = chooseTeacherForClass([SUNITA, MEENA], "12 Sci");
    assert.equal(choice.kind, "none");
    assert.equal(choice.owners.length, 0);
    assert.match(choice.kind === "none" ? choice.message : "", /No teacher/);
  });

  it("does not pick anyone before a class has been chosen", () => {
    const choice = chooseTeacherForClass([SUNITA], "");
    assert.equal(choice.kind, "none");
  });

  it("matches class labels exactly, never by prefix", () => {
    // '1' must not match '10 A'. The labels are strings from the fee app and
    // a prefix match here would quietly reassign half the school.
    const choice = chooseTeacherForClass([RAJESH], "10");
    assert.equal(choice.kind, "none");
  });
});

describe("partitionByClass", () => {
  it("puts the owners first and keeps everybody else available", () => {
    const { owners, others } = partitionByClass([SUNITA, MEENA, RAJESH], "8");
    assert.deepEqual(
      owners.map((teacher) => teacher.id),
      ["t1", "t2"],
    );
    assert.deepEqual(
      others.map((teacher) => teacher.id),
      ["t3"],
    );
  });

  it("puts everyone in others when no class is chosen", () => {
    const { owners, others } = partitionByClass([SUNITA, RAJESH], "");
    assert.equal(owners.length, 0);
    assert.equal(others.length, 2);
  });
});
