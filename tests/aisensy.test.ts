import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buttonParameters,
  campaignFor,
  destinationFor,
  interpretResponse,
} from "../src/lib/aisensy";
import { alreadySentToday } from "../src/lib/whatsapp-send";

/**
 * The pure edges of the API path: what a number becomes, what a campaign is
 * called, and what AiSensy's answer means. The HTTP call itself is not tested
 * here — there is no network in `npm test` — and the test send on
 * Settings → WhatsApp is what proves that end.
 */

describe("destinationFor", () => {
  it("adds the country code to ten digits", () => {
    assert.equal(destinationFor("9876543210"), "+919876543210");
  });

  it("normalises the shapes a number arrives in", () => {
    assert.equal(destinationFor("+91 98765 43210"), "+919876543210");
    assert.equal(destinationFor("098765-43210"), "+919876543210");
  });

  it("refuses anything that is not a complete mobile number", () => {
    assert.equal(destinationFor("98765"), null);
    assert.equal(destinationFor(""), null);
  });
});

describe("campaignFor", () => {
  it("names the campaign after the template", () => {
    const before = process.env.AISENSY_CAMPAIGN_PREFIX;
    delete process.env.AISENSY_CAMPAIGN_PREFIX;
    try {
      assert.equal(campaignFor("request", "hi"), "sampark_request_hi");
      assert.equal(campaignFor("reminder", "en"), "sampark_reminder_en");
      assert.equal(campaignFor("link", "hi"), "sampark_link_hi");
    } finally {
      if (before !== undefined) process.env.AISENSY_CAMPAIGN_PREFIX = before;
    }
  });

  it("honours a renamed prefix", () => {
    const before = process.env.AISENSY_CAMPAIGN_PREFIX;
    process.env.AISENSY_CAMPAIGN_PREFIX = "vpps";
    try {
      assert.equal(campaignFor("request", "en"), "vpps_request_en");
    } finally {
      if (before === undefined) delete process.env.AISENSY_CAMPAIGN_PREFIX;
      else process.env.AISENSY_CAMPAIGN_PREFIX = before;
    }
  });
});

describe("interpretResponse", () => {
  it("treats a 200 with no error as sent", () => {
    const result = interpretResponse(200, { success: true, submitted_message_id: "abc" });
    assert.equal(result.ok, true);
  });

  it("treats a 200 carrying `error` as a failure, verbatim", () => {
    // This is how a wrong campaign name or a param-count mismatch comes back.
    const result = interpretResponse(200, { error: "Template params does not match the campaign!" });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "Template params does not match the campaign!");
  });

  it("reports the status when a non-200 carries no message", () => {
    const result = interpretResponse(502, "<html>Bad gateway</html>");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "AiSensy answered 502");
  });

  it("uses `message` when that is all a failure says", () => {
    const result = interpretResponse(401, { message: "Invalid API key" });
    assert.equal(result.ok === false && result.error, "Invalid API key");
  });
});

describe("buttonParameters", () => {
  it("fills the one URL button in Meta's own shape", () => {
    // What the live campaign accepted on 2026-09-04; a fifth templateParam
    // was refused with "Template params does not match the campaign".
    assert.deepEqual(buttonParameters("AbCdEfGhIjKlMnOp"), [
      {
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: [{ type: "text", text: "AbCdEfGhIjKlMnOp" }],
      },
    ]);
  });
});

describe("alreadySentToday", () => {
  it("is a double only when every link on the card is ticked", () => {
    assert.equal(alreadySentToday({ links: [{ sent: true }, { sent: true }] }), true);
    assert.equal(alreadySentToday({ links: [{ sent: true }, { sent: false }] }), false);
    assert.equal(alreadySentToday({ links: [] }), false);
  });
});
