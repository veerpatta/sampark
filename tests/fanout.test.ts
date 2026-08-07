import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planFanOut,
  planSubjectFanOut,
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
  /**
   * Scoped to the STUDENT-BUCKETED modes, deliberately.
   *
   * class, house and route each read one column off the student row, so every
   * child lands in exactly one group and this sum is an accounting identity. A
   * subject send is not like that — a Class 8 child taught five subjects belongs
   * to five groups — so `totals.students` there counts student-LINKS. Weakening
   * this assertion to cover both would give up the identity in the three modes
   * where it is real; see the subject totals test below for its counterpart.
   */
  for (const mode of ["class_teacher", "house_incharge", "route_incharge"] as const) {
    it(`counts every child exactly once in ${mode}`, () => {
      const students = [
        student("s1", "Class 6", "Rana Pratap", "Amet City"),
        student("s2", "Class 6", "Rana Sanga", null),
        student("s3", "Class 6", null, "Amet City"),
      ];
      const plan = planFanOut(
        students,
        [
          teacher("t1", "Sunita", {
            classes: ["Class 6"],
            houses: ["Rana Pratap"],
            routes: ["Amet City"],
          }),
        ],
        mode,
      );

      assert.equal(plan.totals.students + plan.totals.skipped, students.length);
    });
  }
});

/* ============================ subject fan-out ============================ */

const MATHS = { key: "maths", en: "Maths", fieldKey: "fa_maths" };
const HINDI = { key: "hindi", en: "Hindi", fieldKey: "fa_hindi" };

const assign = (teacherId: string, subjectKey: string, classLabel: string) => ({
  teacherId,
  subjectKey,
  classLabel,
});

describe("planSubjectFanOut", () => {
  it("gives one teacher ONE link for a subject she teaches to several classes", () => {
    // The whole reason for grouping by (teacher, subject) rather than by class:
    // Prakash's four Economics classes are one screen, not four messages.
    const students = [
      student("s1", "11 Commerce"),
      student("s2", "12 Commerce"),
      student("s3", "12 Arts"),
    ];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash")],
      [
        assign("t1", "maths", "11 Commerce"),
        assign("t1", "maths", "12 Commerce"),
        assign("t1", "maths", "12 Arts"),
      ],
      [MATHS],
    );

    assert.equal(plan.ready.length, 1);
    assert.deepEqual(plan.ready[0]!.studentIds.sort(), ["s1", "s2", "s3"]);
    assert.equal(plan.ready[0]!.teacherName, "Prakash");
  });

  it("asks each link for its own subject and nothing else", () => {
    // The structural point. A batch collecting Maths and Hindi must not put a
    // Hindi box on the Maths teacher's screen.
    const students = [student("s1", "Class 8")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash"), teacher("t2", "Jainendra")],
      [assign("t1", "maths", "Class 8"), assign("t2", "hindi", "Class 8")],
      [MATHS, HINDI],
    );

    assert.equal(plan.ready.length, 2);
    assert.deepEqual(
      plan.ready.map((group) => group.fieldKeys),
      [["fa_maths"], ["fa_hindi"]],
    );
  });

  it("names the teacher in the label, because seven people teach Maths", () => {
    // audience_label is unique per batch by index. The subject alone collides.
    const students = [student("s1", "Class 8"), student("s2", "Class 9")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash"), teacher("t2", "Nathulal")],
      [assign("t1", "maths", "Class 8"), assign("t2", "maths", "Class 9")],
      [MATHS],
    );

    const labels = plan.ready.map((group) => group.scope.value);
    assert.deepEqual(labels, ["Maths — Nathulal", "Maths — Prakash"]);
    assert.equal(new Set(labels).size, labels.length);
  });

  it("blocks a class nobody is down to teach, rather than skipping it quietly", () => {
    const students = [student("s1", "Class 8"), student("s2", "Class 3")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash")],
      [assign("t1", "maths", "Class 8")],
      [MATHS],
    );

    assert.equal(plan.ready.length, 1);
    assert.equal(plan.blocked.length, 1);
    assert.equal(plan.blocked[0]!.reason, "no-owner");
    assert.deepEqual(plan.blocked[0]!.studentIds, ["s2"]);
  });

  it("blocks a class with two names against it instead of picking one", () => {
    const students = [student("s1", "Class 8")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash"), teacher("t2", "Nathulal")],
      [assign("t1", "maths", "Class 8"), assign("t2", "maths", "Class 8")],
      [MATHS],
    );

    assert.equal(plan.ready.length, 0);
    assert.equal(plan.blocked[0]!.reason, "many-owners");
    assert.match(plan.blocked[0]!.message, /2 teachers are down for Maths in Class 8/);
  });

  it("blocks a teacher with no number rather than freezing a roster for nobody", () => {
    const students = [student("s1", "Class 8")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash", { phone: "" })],
      [assign("t1", "maths", "Class 8")],
      [MATHS],
    );

    assert.equal(plan.ready.length, 0);
    assert.equal(plan.blocked[0]!.reason, "no-phone");
  });

  it("keeps blocked classes separate so one override cannot cover two", () => {
    // Merging "nobody teaches Hindi to Class 3 or Class 4" into one row would
    // make the office's single choice silently apply to both.
    const students = [student("s1", "Class 3"), student("s2", "Class 4")];
    const plan = planSubjectFanOut(students, [teacher("t1", "X")], [], [HINDI]);

    assert.equal(plan.blocked.length, 2);
    assert.deepEqual(
      plan.blocked.map((group) => group.scope.value),
      ["Hindi — Class 3", "Hindi — Class 4"],
    );
  });

  it("counts student-LINKS, because a child is taught more than one subject", () => {
    // The counterpart to the identity above. One child, two subjects, two links
    // — reporting "1 child" would be as wrong as reporting "2 children".
    const students = [student("s1", "Class 8")];
    const plan = planSubjectFanOut(
      students,
      [teacher("t1", "Prakash"), teacher("t2", "Jainendra")],
      [assign("t1", "maths", "Class 8"), assign("t2", "hindi", "Class 8")],
      [MATHS, HINDI],
    );

    assert.equal(plan.totals.links, 2);
    assert.equal(plan.totals.students, 2);
    assert.equal(plan.unassigned.length, 0);
  });
});
