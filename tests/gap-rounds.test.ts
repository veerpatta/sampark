import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, ne } from "drizzle-orm";
import { cleanup, createFanOutScenario } from "./fixtures";
import { MASTER_AUDIENCE_KIND } from "../src/lib/office";
import { db, schema } from "../src/lib/db";
import { createBatch, previewBatch, resumeBatch } from "../src/lib/batches";
import { countAudience, listAudienceRoster, type Audience } from "../src/lib/students";
import { RequestValidationError } from "../src/lib/requests";

/**
 * Turning a filtered view into a send, against the real database.
 *
 * What a mock could not tell you: that the four phone predicates mean in SQL
 * what their names say, that a NULL in phone_on_whatsapp is NOT "not on
 * WhatsApp", and — the one that earns the whole design — that a round frozen on
 * Monday finishes over the same children on Thursday even though the office has
 * spent Tuesday filling in exactly the gap it was asking about.
 *
 * EVERY AUDIENCE HERE IS SCOPED TO THE SCENARIO'S OWN CLASSES, and that is not
 * tidiness. `{gaps: ["photo"]}` with no class narrows to every photo-less child
 * in the database — every other test file's fixtures included, mid-delete —
 * which is precisely the cross-file race the per-file prefix in fixtures.ts
 * exists to kill. createFanOutScenario's synthetic class labels are what make
 * these audiences safe.
 */

before(cleanup);
after(cleanup);

function futureDate(): string {
  return new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
}

async function groupRequestsIn(batchId: string) {
  return db
    .select()
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.batchId, batchId),
        ne(schema.requests.audienceKind, MASTER_AUDIENCE_KIND),
      ),
    );
}

describe("the phone-shape audiences", () => {
  /*
   * Four children, one per shape, so a single scenario answers every predicate:
   *
   *   0A  both numbers, and they differ          — a real fallback
   *   0B  one number only                        — onlyOnePhone
   *   1A  both numbers, identical                — samePhones
   *   1B  a number marked as not on WhatsApp     — notOnWhatsapp
   */
  async function shapedScenario() {
    return createFanOutScenario({
      each: [
        { phone: "9111111111", altPhone: "9222222222" },
        { phone: "9333333333", altPhone: null },
        { phone: "9444444444", altPhone: "9444444444" },
        { phone: "9555555555", altPhone: "9666666666", phoneOnWhatsapp: "no" },
      ],
    });
  }

  async function idsFor(scenario: Awaited<ReturnType<typeof shapedScenario>>, gaps: Audience["gaps"]) {
    const roster = await listAudienceRoster({
      classes: scenario.groups.map((group) => group.classLabel),
      gaps,
    });
    return roster.map((student) => student.id).sort();
  }

  test("finds the child with a number and no fallback", async () => {
    const scenario = await shapedScenario();
    assert.deepEqual(await idsFor(scenario, ["onlyOnePhone"]), [
      scenario.groups[0]!.studentIds[1],
    ]);
  });

  test("finds the child whose second number is the first one again", async () => {
    const scenario = await shapedScenario();
    assert.deepEqual(await idsFor(scenario, ["samePhones"]), [
      scenario.groups[1]!.studentIds[0],
    ]);
  });

  test("finds every child with no second number at all", async () => {
    // Wider than onlyOnePhone on purpose: this one includes a child with no
    // number whatsoever, and that difference is why both filters exist.
    const scenario = await shapedScenario();
    assert.deepEqual(await idsFor(scenario, ["altPhone"]), [
      scenario.groups[0]!.studentIds[1],
    ]);
  });

  test("does not read 'nobody has checked' as 'not on WhatsApp'", async () => {
    /*
     * THE BUG THIS PREVENTS IS THE WHOLE SCHOOL.
     *
     * phone_on_whatsapp is NULL on every row until somebody checks one, so a
     * predicate written as "is not true" would open a work list of five hundred
     * children on the day the column was added, and bury the thirty-odd the
     * office actually knows about.
     */
    const scenario = await shapedScenario();
    assert.deepEqual(await idsFor(scenario, ["notOnWhatsapp"]), [
      scenario.groups[1]!.studentIds[1],
    ]);
  });

  test("narrows rather than widens when two holes are asked for at once", async () => {
    const scenario = await shapedScenario();
    const classes = scenario.groups.map((group) => group.classLabel);
    // No child is both, so the AND across dimensions must produce nobody —
    // a union would quietly produce two.
    assert.equal(
      await countAudience({ classes, gaps: ["onlyOnePhone", "samePhones"] }),
      0,
    );
  });
});

describe("a round narrowed to a gap", () => {
  /** Two classes; in each, the first child has a photo and the second does not. */
  async function photoScenario() {
    return createFanOutScenario({
      each: [
        { photoPath: "students/a/one.jpg" },
        {},
        { photoPath: "students/b/one.jpg" },
        {},
      ],
    });
  }

  test("gives each teacher a link carrying only her own flagged children", async () => {
    /*
     * THE FEATURE, IN ONE ASSERTION. The office filtered five hundred children
     * down to the ones with no photograph and pressed one button; each class
     * teacher gets her own link, and it carries two names rather than forty.
     */
    const scenario = await photoScenario();

    const result = await createBatch({
      title: "Photo round",
      audience: {
        classes: scenario.groups.map((group) => group.classLabel),
        gaps: ["photo"],
      },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
      reason: { en: "2 children: No photo", hi: "2 बच्चे: फ़ोटो बाकी है" },
    });

    assert.equal(result.created.length, 2, "one link per class, as always");

    const links = await groupRequestsIn(result.batchId);
    for (const link of links) {
      const roster = await db
        .select({ studentId: schema.requestStudents.studentId })
        .from(schema.requestStudents)
        .where(eq(schema.requestStudents.requestId, link.id));

      assert.equal(roster.length, 1, `${link.audienceLabel} carries one child`);
      const group = scenario.groups.find(
        (candidate) => candidate.classLabel === link.audienceLabel,
      )!;
      assert.equal(
        roster[0]!.studentId,
        group.studentIds[1],
        "and it is the one with no photograph",
      );
    }
  });

  test("stamps the reason on every link, so a part-register is not a broken list", async () => {
    const scenario = await photoScenario();

    const result = await createBatch({
      title: "Photo round",
      audience: {
        classes: scenario.groups.map((group) => group.classLabel),
        gaps: ["photo"],
      },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
      reason: { en: "2 children: No photo", hi: "2 बच्चे: फ़ोटो बाकी है" },
    });

    const links = await groupRequestsIn(result.batchId);
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.equal(link.reasonEn, "2 children: No photo");
      assert.equal(link.reasonHi, "2 बच्चे: फ़ोटो बाकी है");
    }
  });

  test("says the work is done rather than telling the office to widen it", async () => {
    /*
     * An empty gap selection is GOOD NEWS and must not read as a mistake.
     * "Widen it, or check the class list" is right for a class nobody has
     * imported; it is exactly wrong for "every child there already has a
     * photograph", which is the office being told to undo what it just
     * finished.
     */
    const scenario = await createFanOutScenario({
      each: [
        { photoPath: "students/a/1.jpg" },
        { photoPath: "students/a/2.jpg" },
        { photoPath: "students/b/1.jpg" },
        { photoPath: "students/b/2.jpg" },
      ],
    });

    await assert.rejects(
      previewBatch({
        title: "Photo round",
        audience: {
          classes: scenario.groups.map((group) => group.classLabel),
          gaps: ["photo"],
        },
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "class_teacher",
        createdBy: scenario.userId,
      }),
      (error: unknown) =>
        error instanceof RequestValidationError &&
        /Nothing is missing/.test(error.message),
    );
  });
});

describe("freezing what a round resolved", () => {
  test("stores the children it actually found, and what was ticked", async () => {
    const scenario = await createFanOutScenario({
      each: [{ photoPath: "students/a/1.jpg" }, {}, { photoPath: "students/b/1.jpg" }, {}],
    });
    const classes = scenario.groups.map((group) => group.classLabel);

    const result = await createBatch({
      title: "Photo round",
      audience: { classes, gaps: ["photo"] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const [batch] = await db
      .select()
      .from(schema.requestBatches)
      .where(eq(schema.requestBatches.id, result.batchId));

    const stored = batch!.audience as Audience;
    assert.deepEqual(
      stored.studentIds?.sort(),
      [scenario.groups[0]!.studentIds[1], scenario.groups[1]!.studentIds[1]].sort(),
      "the ids it resolved, not the filter that found them",
    );
    assert.deepEqual(
      stored.from?.gaps,
      ["photo"],
      "and what she ticked, so the round's page can still say why",
    );
  });

  test("finishes over the same children after the gap has been filled in", async () => {
    /*
     * THE REASON FREEZING EXISTS, and the one test that would fail without it.
     *
     * A gap audience is defined by the absence of the very data the round is
     * collecting. Send on Monday, skip a class, photograph its children on
     * Tuesday, Resume on Thursday — and a re-resolved audience would create the
     * remaining link over a SMALLER set, or over nobody at all while the board
     * still counted two groups.
     */
    const scenario = await createFanOutScenario({
      each: [{}, {}, {}, {}],
    });
    const classes = scenario.groups.map((group) => group.classLabel);
    const skipped = scenario.groups[1]!;

    const first = await createBatch({
      title: "Photo round",
      audience: { classes, gaps: ["photo"] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
      skip: [`class|${skipped.classLabel}`],
    });
    assert.equal(first.created.length, 1, "one class was deliberately left out");

    // The office spends Tuesday doing exactly what the round asked for.
    await db
      .update(schema.students)
      .set({ photoPath: "students/late/arrival.jpg" })
      .where(eq(schema.students.classLabel, skipped.classLabel));

    const resumed = await resumeBatch(first.batchId, scenario.userId);

    assert.equal(
      resumed.created.length,
      1,
      "the skipped class still gets its link, over the children it was frozen with",
    );
    const links = await groupRequestsIn(first.batchId);
    assert.equal(links.length, 2, "and the round is now complete");

    const late = links.find((link) => link.audienceLabel === skipped.classLabel)!;
    const roster = await db
      .select({ studentId: schema.requestStudents.studentId })
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, late.id));
    assert.equal(
      roster.length,
      2,
      "both children, because the roster was frozen before the photographs arrived",
    );
  });
});

describe("a list the office typed out", () => {
  test("covers exactly those children, and carries their notes to the right rows", async () => {
    const scenario = await createFanOutScenario();
    // One child from each class — a subset no filter could have described.
    const picked = [
      scenario.groups[0]!.studentIds[0]!,
      scenario.groups[1]!.studentIds[1]!,
    ];

    const result = await createBatch({
      title: "Number check",
      audience: { studentIds: picked },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
      reason: { en: "Not on WhatsApp", hi: "Not on WhatsApp" },
      notes: { [picked[0]!]: "The number belongs to an uncle." },
    });

    assert.equal(result.created.length, 2, "one link per class, as always");

    const links = await groupRequestsIn(result.batchId);
    const rows = await db
      .select({
        studentId: schema.requestStudents.studentId,
        askNote: schema.requestStudents.askNote,
      })
      .from(schema.requestStudents)
      .where(
        eq(
          schema.requestStudents.requestId,
          links.find((link) => link.audienceLabel === scenario.groups[0]!.classLabel)!.id,
        ),
      );

    assert.deepEqual(
      rows.map((row) => row.studentId),
      [picked[0]],
      "her link carries her one child and not the rest of her class",
    );
    assert.equal(rows[0]!.askNote, "The number belongs to an uncle.");
  });

  test("ignores a note for a child the list does not name", async () => {
    // Notes explain; they never resolve. A stray one must not become a
    // recipient, which is the one way this field could widen a send.
    const scenario = await createFanOutScenario();
    const picked = [scenario.groups[0]!.studentIds[0]!];

    const result = await createBatch({
      title: "Number check",
      audience: { studentIds: picked },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
      notes: { [scenario.groups[1]!.studentIds[0]!]: "Nobody asked about him." },
    });

    assert.equal(result.created.length, 1);
    const links = await groupRequestsIn(result.batchId);
    const roster = await db
      .select({ studentId: schema.requestStudents.studentId })
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, links[0]!.id));
    assert.deepEqual(roster.map((row) => row.studentId), picked);
  });
});
