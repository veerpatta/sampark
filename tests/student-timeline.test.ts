import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTimeline,
  type LogRow,
  type MembershipRow,
  type RecordRow,
  type SubmissionRow,
  type TimelineParts,
} from "../src/lib/student-timeline";
import type { DocumentRow } from "../src/lib/document-store";

/**
 * The merge is where the mistakes would be: a review batch of nine rows is one
 * event, not nine; a teacher's flush of forty answers is one event; a document
 * attached and later removed is two. Pure, so it is tested without a database.
 */

const at = (iso: string) => new Date(iso);

const log = (over: Partial<LogRow>): LogRow => ({
  id: 1,
  fieldKey: "phone",
  fieldLabel: "Mobile number",
  fromValue: "9000000000",
  toValue: "9000000001",
  decision: "approved",
  decidedBy: "U1",
  decidedByName: "Raj",
  decidedAt: at("2026-09-01T10:00:00Z"),
  note: null,
  submissionId: "s1",
  ...over,
});

const submission = (over: Partial<SubmissionRow>): SubmissionRow => ({
  id: "s1",
  requestId: "r1",
  requestTitle: "Phone round",
  audienceLabel: "Class 8",
  teacherName: "Sunita",
  fieldKey: "phone",
  fieldLabel: "Mobile number",
  inputType: "tel",
  action: "changed",
  oldValue: "9000000000",
  newValue: "9000000001",
  reviewStatus: "pending",
  submittedAt: at("2026-08-30T09:00:00Z"),
  idempotencyKey: "k1",
  ...over,
});

const record = (over: Partial<RecordRow>): RecordRow => ({
  id: 1,
  fieldKey: "fa_maths",
  fieldLabel: "FA Maths",
  recordKind: "fa_marks",
  maxValue: "25",
  sortOrder: 10,
  period: "2026-27/FA1",
  value: "18",
  requestId: "r2",
  requestTitle: "FA1 maths",
  teacherName: "Prakash",
  createdAt: at("2026-08-20T09:00:00Z"),
  ...over,
});

const membership = (over: Partial<MembershipRow>): MembershipRow => ({
  requestId: "r1",
  title: "Phone round",
  audienceLabel: "Class 8",
  teacherName: "Sunita",
  createdAt: at("2026-08-25T09:00:00Z"),
  sentAt: at("2026-08-26T09:00:00Z"),
  status: "open",
  ...over,
});

const document = (over: Partial<DocumentRow>): DocumentRow => ({
  id: "d1",
  kind: "tc",
  label: null,
  pathname: "documents/S1/20260901-000000000000000000000000.pdf",
  contentType: "application/pdf",
  bytes: 1000,
  uploadedAt: at("2026-09-02T09:00:00Z"),
  uploadedByName: "Raj",
  removedAt: null,
  removedByName: null,
  ...over,
});

const parts = (over: Partial<TimelineParts>): TimelineParts => ({
  log: [],
  submissions: [],
  records: [],
  memberships: [],
  documents: [],
  ...over,
});

describe("mergeTimeline", () => {
  it("is empty for a child nothing has happened to", () => {
    assert.deepEqual(mergeTimeline(parts({})), []);
  });

  it("collapses a review batch into one event, one line per field", () => {
    const events = mergeTimeline(
      parts({
        log: [
          log({ id: 1, fieldKey: "phone" }),
          log({ id: 2, fieldKey: "father_name", fieldLabel: "Father's name", fromValue: "A", toValue: "B" }),
          log({ id: 3, fieldKey: "phone", decision: "rejected", decidedAt: at("2026-09-01T10:00:00Z") }),
        ],
      }),
    );
    assert.equal(events.length, 2);
    const approved = events.find((event) => event.kind === "approved")!;
    assert.equal(approved.title, "2 changes approved into the record");
    assert.equal(approved.who, "Raj");
    assert.deepEqual(
      approved.lines.map((line) => line.label),
      ["Mobile number", "Father's name"],
    );
    assert.equal(events.find((event) => event.kind === "rejected")!.title, "1 proposed change rejected");
  });

  it("reads an office edit and a creation as facts, not verdicts", () => {
    const events = mergeTimeline(
      parts({
        log: [
          log({ id: 1, decision: "edited", submissionId: null, note: "parent rang" }),
          log({ id: 2, decision: "created", submissionId: null, fromValue: null, decidedAt: at("2026-08-01T10:00:00Z") }),
          log({ id: 3, decision: "created", submissionId: null, fieldKey: "name", fieldLabel: null, fromValue: null, decidedAt: at("2026-08-01T10:00:00Z") }),
        ],
      }),
    );
    assert.equal(events[0]!.kind, "edited");
    assert.equal(events[0]!.title, "1 field edited by hand");
    assert.equal(events[0]!.note, "parent rang");
    assert.equal(events[1]!.kind, "created");
    assert.equal(events[1]!.title, "Record created with 2 fields");
    // No registry label for `name`: the key itself is shown rather than nothing.
    assert.ok(events[1]!.lines.some((line) => line.label === "name"));
  });

  it("collapses a teacher's flush into one event keyed on the idempotency key", () => {
    const events = mergeTimeline(
      parts({
        submissions: [
          submission({ id: "a", fieldKey: "phone" }),
          submission({ id: "b", fieldKey: "father_name", fieldLabel: "Father's name", action: "confirmed", submittedAt: at("2026-08-30T09:00:02Z") }),
          submission({ id: "c", idempotencyKey: "k2", action: "not_present", submittedAt: at("2026-08-31T09:00:00Z") }),
        ],
      }),
    );
    assert.equal(events.length, 2);
    const [later, earlier] = events;
    assert.equal(later!.lines[0]!.meta, "teacher says not in this class");
    assert.equal(earlier!.title, "Sunita answered 2 fields in Phone round");
    assert.equal(earlier!.href, "/requests/r1");
    // The group's time is its latest answer.
    assert.equal(earlier!.at.toISOString(), "2026-08-30T09:00:02.000Z");
    assert.equal(earlier!.lines[0]!.meta, "waiting for review");
    assert.equal(earlier!.lines[1]!.meta, "confirmed as correct");
  });

  it("marks a photo diff so the renderer can draw faces rather than pathnames", () => {
    const events = mergeTimeline(
      parts({ submissions: [submission({ fieldKey: "photo", inputType: "photo", oldValue: null, newValue: "students/S1/x.jpg" })] }),
    );
    assert.equal(events[0]!.lines[0]!.photo, true);
  });

  it("groups marks by request and says what they are out of", () => {
    const events = mergeTimeline(
      parts({
        records: [record({ id: 1 }), record({ id: 2, fieldKey: "fa_science", fieldLabel: "FA Science", value: "20" })],
      }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.title, "Prakash entered 2 marks for 2026-27/FA1");
    assert.equal(events[0]!.lines[0]!.meta, "out of 25");
    assert.equal(events[0]!.lines[0]!.to, "18");
  });

  it("records when a child was included in a round, at the send time", () => {
    const events = mergeTimeline(parts({ memberships: [membership({})] }));
    assert.equal(events[0]!.kind, "included");
    assert.equal(events[0]!.at.toISOString(), "2026-08-26T09:00:00.000Z");
    assert.match(events[0]!.lines[0]!.meta!, /sent for Sunita/);
  });

  it("gives a removed document two events", () => {
    const events = mergeTimeline(
      parts({
        documents: [document({ removedAt: at("2026-09-03T09:00:00Z"), removedByName: "Komal", label: "from Govt. school" })],
      }),
    );
    assert.deepEqual(
      events.map((event) => [event.kind, event.who]),
      [
        ["document_removed", "Komal"],
        ["document_added", "Raj"],
      ],
    );
    assert.equal(events[1]!.title, "Document attached: Transfer certificate — from Govt. school");
  });

  it("reads newest first, and a creation before its own same-instant edits", () => {
    const same = at("2026-08-01T10:00:00Z");
    const events = mergeTimeline(
      parts({
        log: [
          log({ id: 1, decision: "edited", submissionId: null, decidedAt: same }),
          log({ id: 2, decision: "created", submissionId: null, decidedAt: same }),
        ],
        memberships: [membership({ sentAt: at("2026-08-26T09:00:00Z") })],
        documents: [document({})],
      }),
    );
    assert.deepEqual(
      events.map((event) => event.kind),
      ["document_added", "included", "edited", "created"],
    );
  });
});
