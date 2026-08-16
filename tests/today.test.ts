import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isoDay, isoDayFrom, todayISO } from "../src/lib/today";

/**
 * The 5½ hours each night when the console and the teacher disagreed.
 *
 * IST is UTC+5:30, so from 18:30 UTC to midnight UTC the school is already on
 * the next calendar day. The boards computed today with `toISOString()` — the
 * UTC date — while the teacher's page and the token resolver used Asia/Kolkata.
 * In that window the office was told a request was overdue that she was still
 * being shown as due today.
 *
 * These take the instant as an argument, so the window is tested rather than
 * waited for.
 */

describe("isoDay", () => {
  it("is still yesterday's date at 23:59 UTC — because IST is already tomorrow", () => {
    // 18:29 UTC = 23:59 IST on the 16th. Same day either way; the boundary has
    // not been crossed yet.
    assert.equal(isoDay(new Date("2026-08-16T18:29:00Z")), "2026-08-16");
  });

  it("rolls to the next day at 18:30 UTC, which is midnight in Amet", () => {
    // THE BUG, in one assertion. `toISOString().slice(0, 10)` says 2026-08-16
    // here; the school says the 17th, and due_date is a calendar column.
    assert.equal(isoDay(new Date("2026-08-16T18:30:00Z")), "2026-08-17");
    assert.notEqual(
      isoDay(new Date("2026-08-16T18:30:00Z")),
      new Date("2026-08-16T18:30:00Z").toISOString().slice(0, 10),
    );
  });

  it("agrees with the UTC date during the working day", () => {
    // 09:00 UTC = 14:30 IST. Most of the time the two rules gave the same
    // answer, which is exactly why this survived so long.
    const at = new Date("2026-08-16T09:00:00Z");
    assert.equal(isoDay(at), at.toISOString().slice(0, 10));
  });

  it("formats as YYYY-MM-DD, which is what due_date holds", () => {
    // Every comparison in the app is lexical against a DATE column.
    assert.match(isoDay(new Date("2026-01-05T09:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(isoDay(new Date("2026-01-05T09:00:00Z")), "2026-01-05");
  });
});

describe("isoDayFrom", () => {
  it("counts five days on in the school's zone", () => {
    assert.equal(isoDayFrom(new Date("2026-08-16T09:00:00Z"), 5), "2026-08-21");
  });

  it("counts five days on from INSIDE the window, without losing one", () => {
    // 00:30 IST on the 17th. The old helper answered 21 August; five days from
    // the 17th is the 22nd, and a due date a day short is a teacher chased a
    // day early.
    assert.equal(isoDayFrom(new Date("2026-08-16T19:00:00Z"), 5), "2026-08-22");
  });

  it("goes backwards for the grace floor", () => {
    // What the token resolver's loose floor uses. Negative days, same rule.
    assert.equal(isoDayFrom(new Date("2026-08-16T09:00:00Z"), -4), "2026-08-12");
  });

  it("crosses a month end", () => {
    assert.equal(isoDayFrom(new Date("2026-08-30T09:00:00Z"), 5), "2026-09-04");
  });
});

describe("todayISO", () => {
  it("is isoDay of now, and is what every board compares a due date against", () => {
    const at = new Date("2026-08-16T19:00:00Z");
    assert.equal(todayISO(at), isoDay(at));
  });
});
