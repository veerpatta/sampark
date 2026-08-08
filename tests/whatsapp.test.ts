import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderMessage,
  buildRequestMessage,
  buildRoundMessage,
  buildWhatsAppLink,
  describeAudienceHi,
  describeAudienceLineHi,
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

describe("the link carries the recipient, not just the text", () => {
  /**
   * The office reported sending as "it just copies the text". The cause was the
   * OS share sheet: navigator.share takes `{ text }` and has no field for WHO,
   * so it handed over the message and asked her to find the teacher herself —
   * forty times in a marks round, with the number sitting right there on the
   * teacher's row. Every send surface is a wa.me link now, and these assert the
   * two halves that makes it work.
   */
  it("puts the number in the path, so WhatsApp opens on her chat", () => {
    const link = buildWhatsAppLink("9876543210", "नमस्ते");
    assert.equal(new URL(link).pathname, "/919876543210");
  });

  it("carries the whole Hindi body, newlines and all", () => {
    const message = buildRequestMessage({
      ...base,
      audience: { kind: "class", label: "Class 8" },
    });
    const link = buildWhatsAppLink("9876543210", message);
    assert.equal(new URL(link).searchParams.get("text"), message);
  });

  it("still opens the contact picker when no number is saved", () => {
    // Should not happen — the fan-out blocks a group whose teacher has none —
    // but a link with an empty path is WhatsApp's own picker with the message
    // attached, which beats a dead button.
    const link = buildWhatsAppLink("", "hello");
    assert.equal(new URL(link).pathname, "/");
    assert.equal(new URL(link).searchParams.get("text"), "hello");
  });
});

describe("buildRoundMessage", () => {
  /**
   * One message carrying everything a teacher has to do this round.
   *
   * A marks round is thirty-eight links across sixteen teachers. This is what
   * makes it sixteen conversations — but thirteen of those teachers have a
   * single link and must not notice anything changed.
   */
  const one = { audience: { kind: "class" as const, label: "Class 8" }, url: "https://x.invalid/r/a" };

  it("delegates to buildRequestMessage, byte for byte, for a single link", () => {
    // The compatibility contract. If this breaks, most of the staff receive a
    // message shape nobody reviewed.
    assert.equal(
      buildRoundMessage({
        teacherName: "Sunita",
        title: "फ़ोन नंबर",
        dueDate: "2026-08-20",
        links: [one],
      }),
      buildRequestMessage({ ...base, audience: one.audience, url: one.url }),
    );
  });

  it("carries every URL when there are several", () => {
    const message = buildRoundMessage({
      teacherName: "Prateek",
      title: "FA-1 अंक",
      dueDate: "2026-08-20",
      links: [
        { audience: { kind: "subject", label: "Maths — Prateek", fieldKeys: ["fa_maths"] }, url: "https://x.invalid/r/a" },
        { audience: { kind: "subject", label: "Physics — Prateek", fieldKeys: ["fa_physics"] }, url: "https://x.invalid/r/b" },
        { audience: { kind: "subject", label: "Science — Prateek", fieldKeys: ["fa_science"] }, url: "https://x.invalid/r/c" },
      ],
    });

    for (const url of ["https://x.invalid/r/a", "https://x.invalid/r/b", "https://x.invalid/r/c"]) {
      assert.ok(message.includes(url), `${url} is missing`);
    }
    assert.ok(message.includes("गणित"));
    assert.ok(message.includes("भौतिक विज्ञान"));
    assert.ok(message.includes("विज्ञान"));
    assert.ok(message.includes("1)") && message.includes("2)") && message.includes("3)"));
  });

  it("says the how-to ONCE, not per link", () => {
    // The checkable form of "three links must not become a wall". Counted on
    // the tail of the instruction, because the sentence itself legitimately
    // says सही है twice — जो सही है उस पर "सही है" दबाएँ.
    const message = buildRoundMessage({
      teacherName: "Prateek",
      title: "FA-1 अंक",
      dueDate: "2026-08-20",
      links: [
        { audience: { kind: "class", label: "Class 8" }, url: "https://x.invalid/r/a" },
        { audience: { kind: "class", label: "Class 9" }, url: "https://x.invalid/r/b" },
      ],
    });
    assert.equal(message.split("दबाकर ठीक कर दें").length - 1, 1);
  });

  it("keeps Latin digits, like every other teacher-facing string", () => {
    const message = buildRoundMessage({
      teacherName: "Prateek",
      title: "FA-1 अंक",
      dueDate: "2026-08-20",
      links: [
        { audience: { kind: "class", label: "Class 8" }, url: "https://x.invalid/r/a" },
        { audience: { kind: "class", label: "Class 9" }, url: "https://x.invalid/r/b" },
      ],
    });
    assert.ok(!/[०-९]/.test(message), "Devanagari numerals reached a teacher");
  });

  it("appends her durable page only when there is one, and once", () => {
    const withPage = buildRoundMessage({
      teacherName: "Sunita",
      title: "फ़ोन नंबर",
      dueDate: "2026-08-20",
      links: [one],
      teacherPageUrl: "https://x.invalid/t/zzzz",
    });
    assert.equal(withPage.split("https://x.invalid/t/zzzz").length - 1, 1);
    assert.ok(!buildRoundMessage({
      teacherName: "Sunita", title: "फ़ोन नंबर", dueDate: "2026-08-20", links: [one],
    }).includes("/t/"));
  });

  it("survives the round trip into a wa.me link", () => {
    const message = buildRoundMessage({
      teacherName: "Prateek",
      title: "FA-1 अंक",
      dueDate: "2026-08-20",
      links: [
        { audience: { kind: "subject", label: "Maths — Prateek", fieldKeys: ["fa_maths"] }, url: "https://x.invalid/r/a" },
        { audience: { kind: "subject", label: "Physics — Prateek", fieldKeys: ["fa_physics"] }, url: "https://x.invalid/r/b" },
      ],
    });
    const link = buildWhatsAppLink("9876543210", message);
    assert.equal(new URL(link).searchParams.get("text"), message);
  });
});

describe("describeAudienceLineHi", () => {
  it("drops the qualifier a subject line does not need", () => {
    // "(आपकी कक्षाएँ)" disambiguates a lone link; among three of hers it is
    // three redundant words per line.
    const audience = { kind: "subject", label: "Maths — X", fieldKeys: ["fa_maths"] };
    assert.equal(describeAudienceLineHi(audience), "गणित");
    assert.equal(describeAudienceHi(audience), "गणित (आपकी कक्षाएँ)");
  });

  it("is identical to describeAudienceHi for every other kind", () => {
    for (const audience of [
      { kind: "class", label: "Class 8" },
      { kind: "house", label: "Rana Pratap" },
      { kind: "route", label: "Amet City" },
    ]) {
      assert.equal(describeAudienceLineHi(audience), describeAudienceHi(audience));
    }
  });
});
