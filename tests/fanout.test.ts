import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planFanOut,
  type PlannableStudent,
  type Recipient,
} from "../src/lib/fanout";

/**
 * Turning one audience into N links.
 *
 * The case worth the most here is `unassigned`. Only about a third of the school
 * has a house on record, so grouping by house drops the rest — and a plan that
 * reported only "4 links, 151 children" would read as success.
 */

const student = (
  id: string,
  classLabel: string,
  house: string | null = null,
  busRoute: string | null = null,
): PlannableStudent => ({
  id,
  name: `Child ${id}`,
  classLabel,
  house,
  busRoute,
});

const teacher = (
  id: string,
  name: string,
  extra: Partial<Recipient> = {},
): Recipient => ({
  id,
  name,
  phone: "9000000000",
  classes: [],
  houses: [],
  routes: [],
  ...extra,
});

describe("planFanOut by class", () => {
  it("makes one link per class and hands each teacher only her own children", () => {
    const students = [
      student("s1", "Class 6"),
      student("s2", "Class 6"),
      student("s3", "Class 7"),
    ];
    const teachers = [
      teacher("t1", "Sunita", { classes: ["Class 6"] }),
      teacher("t2", "Meena", { classes: ["Class 7"] }),
    ];

    const plan = planFanOut(students, teachers, "class_teacher");

    assert.equal(plan.ready.length, 2);
    assert.equal(plan.totals.links, 2);
    assert.equal(plan.totals.students, 3);
    assert.deepEqual(plan.ready[0]!.studentIds, ["s1", "s2"]);
    assert.equal(plan.ready[0]!.teacherName, "Sunita");
    assert.deepEqual(plan.ready[1]!.studentIds, ["s3"]);
  });

  it("drops nobody, because every child has a class", () => {
    const plan = planFanOut(
      [student("s1", "Class 6", null, null)],
      [teacher("t1", "Sunita", { classes: ["Class 6"] })],
      "class_teacher",
    );
    assert.equal(plan.unassigned.length, 0);
  });

  it("orders classes the way a timetable reads, not alphabetically", () => {
    const students = [student("s1", "Class 10"), student("s2", "Class 6")];
    const teachers = [
      teacher("t1", "A", { classes: ["Class 10"] }),
      teacher("t2", "B", { classes: ["Class 6"] }),
    ];

    const plan = planFanOut(students, teachers, "class_teacher");
    assert.deepEqual(
      plan.ready.map((group) => group.scope.value),
      ["Class 6", "Class 10"],
    );
  });
});

describe("planFanOut by house", () => {
  it("names every child it cannot place rather than quietly shrinking", () => {
    // The failure this exists to prevent: the office reads "1 link, 2 children"
    // as success and never learns the other three were never asked.
    const students = [
      student("s1", "Class 6", "Rana Pratap"),
      student("s2", "Class 9", "Rana Pratap"),
      student("s3", "Class 6", null),
      student("s4", "Class 7", null),
      student("s5", "Class 8", null),
    ];
    const teachers = [teacher("t1", "Sunita", { houses: ["Rana Pratap"] })];

    const plan = planFanOut(students, teachers, "house_incharge");

    assert.equal(plan.ready.length, 1);
    assert.equal(plan.totals.students, 2);
    assert.equal(plan.unassigned.length, 3);
    assert.equal(plan.totals.skipped, 3);
    assert.deepEqual(
      plan.unassigned.map((row) => row.studentId),
      ["s3", "s4", "s5"],
    );
    assert.equal(plan.unassigned[0]!.reason, "no house on record");
  });

  it("puts children from several classes on one in-charge's link", () => {
    const students = [
      student("s1", "Class 6", "Rana Pratap"),
      student("s2", "Class 12 Science", "Rana Pratap"),
    ];
    const plan = planFanOut(
      students,
      [teacher("t1", "Sunita", { houses: ["Rana Pratap"] })],
      "house_incharge",
    );

    assert.equal(plan.ready.length, 1);
    assert.deepEqual(plan.ready[0]!.studentIds, ["s1", "s2"]);
  });

  it("blocks a house with two in-charges instead of picking one", () => {
    const plan = planFanOut(
      [student("s1", "Class 6", "Rana Pratap")],
      [
        teacher("t1", "Sunita", { houses: ["Rana Pratap"] }),
        teacher("t2", "Meena", { houses: ["Rana Pratap"] }),
      ],
      "house_incharge",
    );

    assert.equal(plan.ready.length, 0);
    assert.equal(plan.blocked.length, 1);
    assert.equal(plan.blocked[0]!.reason, "many-owners");
    assert.equal(plan.totals.skipped, 1);
  });

  it("blocks a house nobody is in-charge of", () => {
    const plan = planFanOut(
      [student("s1", "Class 6", "Rana Sanga")],
      [teacher("t1", "Sunita", { houses: ["Rana Pratap"] })],
      "house_incharge",
    );

    assert.equal(plan.blocked.length, 1);
    assert.equal(plan.blocked[0]!.reason, "no-owner");
  });
});

describe("planFanOut by route", () => {
  it("blocks an in-charge with no number rather than freezing a roster", () => {
    const plan = planFanOut(
      [student("s1", "Class 6", null, "Amet City")],
      [teacher("t1", "Sunita", { routes: ["Amet City"], phone: "" })],
      "route_incharge",
    );

    assert.equal(plan.ready.length, 0);
    assert.equal(plan.blocked[0]!.reason, "no-phone");
    assert.match(plan.blocked[0]!.message, /No number is saved for Sunita/);
  });

  it("counts a child with no route as unassigned, not as covered", () => {
    const plan = planFanOut(
      [student("s1", "Class 6", null, "Amet City"), student("s2", "Class 6")],
      [teacher("t1", "Sunita", { routes: ["Amet City"] })],
      "route_incharge",
    );

    assert.equal(plan.totals.students, 1);
    assert.equal(plan.unassigned[0]!.reason, "no bus route on record");
  });
});

describe("totals", () => {
  it("counts every child exactly once across ready, blocked and unassigned", () => {
    const students = [
      student("s1", "Class 6", "Rana Pratap"),
      student("s2", "Class 6", "Rana Sanga"),
      student("s3", "Class 6", null),
    ];
    const plan = planFanOut(
      students,
      [teacher("t1", "Sunita", { houses: ["Rana Pratap"] })],
      "house_incharge",
    );

    assert.equal(plan.totals.students + plan.totals.skipped, students.length);
  });
});
