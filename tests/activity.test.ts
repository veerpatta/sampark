import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeActivity } from "../src/lib/activity";

const at = (iso: string) => new Date(iso);

describe("mergeActivity", () => {
  it("reads newest first across the three sources and stops at the limit", () => {
    const events = mergeActivity(
      [
        { decidedByName: "Raj", decision: "approved", minute: at("2026-09-01T10:00:00Z"), rows: 9, students: 3, latest: at("2026-09-01T10:00:30Z") },
        { decidedByName: "Komal", decision: "edited", minute: at("2026-09-02T08:00:00Z"), rows: 1, students: 1, latest: at("2026-09-02T08:00:05Z") },
        { decidedByName: "Raj", decision: "created", minute: at("2026-08-30T08:00:00Z"), rows: 6, students: 1, latest: at("2026-08-30T08:00:05Z") },
      ],
      [
        { requestId: "r1", requestTitle: "Phone round", audienceLabel: "Class 8", teacherName: "Sunita", hour: at("2026-09-01T11:00:00Z"), rows: 40, latest: at("2026-09-01T11:20:00Z") },
      ],
      [
        { requestId: "r1", title: "Phone round", audienceLabel: "Class 8", teacherName: "Sunita", sentByName: "Raj", sentAt: at("2026-09-01T09:00:00Z") },
      ],
      3,
    );
    assert.deepEqual(
      events.map((event) => `${event.kind} · ${event.who} ${event.title}`),
      [
        "edited · Komal edited 1 field on 1 student",
        "answered · Sunita answered 40 fields in Phone round (Class 8)",
        "approved · Raj approved 9 changes for 3 students",
      ],
    );
    assert.equal(events[1]!.href, "/requests/r1");
  });

  it("says 'added' for a creation and links a send to its request", () => {
    const events = mergeActivity(
      [{ decidedByName: "Raj", decision: "created", minute: at("2026-08-30T08:00:00Z"), rows: 6, students: 1, latest: at("2026-08-30T08:00:05Z") }],
      [],
      [{ requestId: "r9", title: "Aadhaar", audienceLabel: "Class 6", teacherName: "Ramesh", sentByName: null, sentAt: at("2026-08-29T08:00:00Z") }],
    );
    assert.equal(events[0]!.title, "added 1 student");
    assert.equal(events[1]!.kind, "sent");
    assert.equal(events[1]!.who, null);
    assert.equal(events[1]!.href, "/requests/r9");
  });
});
