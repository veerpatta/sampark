import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reminderVerdict } from "../src/lib/whatsapp-send";

/**
 * What one send inside "Remind all" counts as.
 *
 * The bulk chase never forces, so sendTeacherReminder refuses anyone already
 * reminded today — and that refusal is the feature, not an error. It is what
 * makes a second tap of the button a no-op instead of a second message to
 * sixteen teachers. Counting it as a failure would put a red line under a run
 * that went perfectly, and an office taught to ignore the red line is an office
 * that misses the real one.
 *
 * The two sentences matched here are written by this codebase, not by AiSensy,
 * which is the only reason matching on text is safe. If either is reworded,
 * this file fails rather than the button quietly starting to report every
 * skipped teacher as a failure.
 */

describe("reminderVerdict", () => {
  it("counts a successful send", () => {
    assert.equal(
      reminderVerdict({ ok: true, messages: 1, warning: null }),
      "sent",
    );
  });

  it("counts a send that warned as sent, not as failed", () => {
    // A warning is the provider accepting the message and saying something
    // about it. The message went.
    assert.equal(
      reminderVerdict({ ok: true, messages: 1, warning: "queued for later" }),
      "sent",
    );
  });

  it("treats the double-send guard as skipped", () => {
    assert.equal(
      reminderVerdict({
        ok: false,
        error: "Already reminded today. Untick her, or choose Send again.",
      }),
      "skipped",
    );
  });

  it("treats a teacher who finished mid-run as skipped", () => {
    // An answer can arrive while the loop is still going. Nothing went wrong.
    assert.equal(
      reminderVerdict({
        ok: false,
        error: "She has nothing outstanding any more.",
      }),
      "skipped",
    );
  });

  it("counts a real refusal as failed", () => {
    assert.equal(
      reminderVerdict({
        ok: false,
        error: "Template params does not match the campaign",
      }),
      "failed",
    );
  });

  it("counts the switched-off deployment as failed, not skipped", () => {
    // This one must be loud: it means every teacher after it will refuse too,
    // and it is what the three-in-a-row guard exists to catch.
    assert.equal(
      reminderVerdict({
        ok: false,
        error: "WhatsApp API sending is switched off on this deployment.",
      }),
      "failed",
    );
  });

  it("matches the sentences sendTeacherReminder actually writes", () => {
    // Pinned verbatim. These two strings live in lib/whatsapp-send.ts and the
    // classification above is matched against them; a reword there without one
    // here would silently turn every skip into a failure.
    for (const sentence of [
      "Already reminded today. Untick her, or choose Send again.",
      "She has nothing outstanding any more.",
    ]) {
      assert.equal(reminderVerdict({ ok: false, error: sentence }), "skipped");
    }
  });
});
