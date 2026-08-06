import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderMessage,
  buildRequestMessage,
  buildWhatsAppLink,
  describeAudienceHi,
} from "../src/lib/whatsapp";

/**
 * The message IS the delivery mechanism — there is no sending API behind it, so
 * a wrong number or a group named wrongly is the whole failure, not a cosmetic
 * one.
 */

const base = {
  teacherName: "Sunita",
  title: "फ़ोन नंबर",
  dueDate: "2026-08-20",
  url: "https://example.invalid/r/abc123",
};

describe("describeAudienceHi", () => {
  it("says कक्षा for a class", () => {
    assert.equal(
      describeAudienceHi({ kind: "class", label: "Class 8" }),
      "कक्षा Class 8",
    );
  });

  it("uses the house's own Hindi name — every child knows it", () => {
    assert.equal(
      describeAudienceHi({ kind: "house", label: "Rana Pratap" }),
      "राणा प्रताप सदन",
    );
  });

  it("leaves a bus route in Latin script", () => {
    // Route names are places off the route master. A transliteration nobody
    // uses is harder to recognise than the name written on the bus.
    assert.equal(
      describeAudienceHi({ kind: "route", label: "Amet City" }),
      "Amet City रूट",
    );
  });

  it("falls back to the label for a house it does not know", () => {
    assert.equal(
      describeAudienceHi({ kind: "house", label: "Nonesuch" }),
      "Nonesuch सदन",
    );
  });
});

describe("buildRequestMessage", () => {
  it("carries the link, the group and the due date", () => {
    const message = buildRequestMessage({
      ...base,
      audience: { kind: "class", label: "Class 8" },
    });

    assert.ok(message.includes(base.url), "the link is the point");
    assert.ok(message.includes("कक्षा Class 8"));
    assert.ok(message.includes("Sunita"));
    assert.ok(message.includes("20 Aug"));
  });

  it("names a house send as a house, not as a class", () => {
    const message = buildRequestMessage({
      ...base,
      audience: { kind: "house", label: "Bappa Rawal" },
    });

    assert.ok(message.includes("बप्पा रावल सदन"));
    assert.ok(!message.includes("कक्षा"), "a house link is not a class link");
  });

  it("formats the date in Latin digits", () => {
    // Devanagari digits were removed everywhere: teachers read the Latin ones.
    const message = buildRequestMessage({
      ...base,
      audience: { kind: "class", label: "Class 8" },
    });
    assert.ok(!/[०-९]/.test(message));
  });
});

describe("buildReminderMessage", () => {
  it("nudges without repeating the full instructions", () => {
    const message = buildReminderMessage({
      ...base,
      audience: { kind: "route", label: "Amet City" },
    });

    assert.ok(message.includes("Amet City रूट"));
    assert.ok(message.includes(base.url));
    assert.ok(!message.includes("सही है"), "the how-to belongs in the first message");
  });
});

describe("buildWhatsAppLink", () => {
  it("adds the country code to a ten-digit number", () => {
    const link = buildWhatsAppLink("9876543210", "hello");
    assert.ok(link.startsWith("https://wa.me/919876543210?text="));
  });

  it("strips punctuation before deciding the length", () => {
    assert.ok(
      buildWhatsAppLink("98765 43210", "hi").startsWith(
        "https://wa.me/919876543210",
      ),
    );
  });

  it("leaves an already-prefixed number alone", () => {
    assert.ok(
      buildWhatsAppLink("919876543210", "hi").startsWith(
        "https://wa.me/919876543210",
      ),
    );
  });

  it("escapes the message so a newline or & cannot truncate it", () => {
    const link = buildWhatsAppLink("9876543210", "a&b\nc");
    assert.ok(link.includes("a%26b%0Ac"));
  });
});
