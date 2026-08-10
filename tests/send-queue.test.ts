import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupLinksByRecipient, type QueueLink } from "../src/lib/send-queue";

/**
 * Grouping a batch's links into the messages the office actually sends.
 *
 * A marks round is thirty-eight links across about sixteen teachers. The
 * grouping is what turns that into sixteen conversations — and the two ways it
 * can go wrong both send a link to the wrong person, silently.
 */

const link = (over: Partial<QueueLink> = {}): QueueLink => ({
  requestId: "r1",
  token: "aaaaaaaaaaaaaaaa",
  audienceKind: "subject",
  audienceLabel: "Maths — Prakash Bunkar",
  fieldKeys: ["fa_maths"],
  classLabels: ["Class 11 Science"],
  teacherId: "T20",
  teacherName: "Prakash Bunkar",
  teacherPhone: "9000000001",
  contactPhone: null,
  teacherLinkToken: null,
  rosterSize: 46,
  sent: false,
  ...over,
});

describe("groupLinksByRecipient", () => {
  it("puts one teacher's several links on one card", () => {
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", audienceLabel: "Maths — Prateek" }),
      link({ requestId: "r2", audienceLabel: "Physics — Prateek" }),
      link({ requestId: "r3", audienceLabel: "Science — Prateek" }),
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.links.length, 3);
    assert.equal(groups[0]!.students, 46 * 3);
  });

  it("does NOT merge a link whose number the office overrode", () => {
    // She is on leave for one section and her sister is covering it. Folding
    // that link into her saved-number card would send it to the wrong phone,
    // which is the one failure requests.contact_phone exists to prevent.
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", teacherPhone: "9000000001" }),
      link({
        requestId: "r2",
        teacherPhone: "9111111111",
        contactPhone: "9111111111",
      }),
    ]);

    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((group) => [group.phone, group.overridden]),
      [
        ["9000000001", false],
        ["9111111111", true],
      ],
    );
  });

  it("keeps two teachers who share a name apart", () => {
    // teachers.id is typed by the office; the name is free text and not unique.
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", teacherId: "T01", teacherName: "Bindu Kanwar" }),
      link({
        requestId: "r2",
        teacherId: "T09",
        teacherName: "Bindu Kanwar",
        teacherPhone: "9000000002",
      }),
    ]);

    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((g) => g.teacherId), ["T01", "T09"]);
  });

  it("orders cards by each group's first link, so a Resume appends", () => {
    // A list that reshuffles under a thumb is how somebody loses their place.
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", teacherId: "T20" }),
      link({ requestId: "r2", teacherId: "T09" }),
      link({ requestId: "r3", teacherId: "T20" }),
    ]);
    assert.deepEqual(groups.map((g) => g.teacherId), ["T20", "T09"]);
  });

  it("is sent only when EVERY link on the card is", () => {
    // A Resume that adds a fourth link to a teacher who was sent three puts her
    // back in the queue — the message she received did not carry the new one.
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", sent: true }),
      link({ requestId: "r2", sent: true }),
      link({ requestId: "r3", sent: false }),
    ]);

    assert.equal(groups[0]!.sent, false);
    assert.equal(groups[0]!.sentCount, 2);
  });

  it("is sent when all of them are", () => {
    const groups = groupLinksByRecipient([
      link({ requestId: "r1", sent: true }),
      link({ requestId: "r2", sent: true }),
    ]);
    assert.equal(groups[0]!.sent, true);
    assert.equal(groups[0]!.sentCount, 2);
  });

  it("handles an empty batch without inventing a card", () => {
    assert.deepEqual(groupLinksByRecipient([]), []);
  });
});
