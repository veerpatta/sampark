import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderMessage,
  buildRequestMessage,
  buildRoundMessage,
  buildRoundReminderMessage,
  buildRoundStatusMessage,
  buildWhatsAppLink,
  teacherPageUrl,
  describeAudienceEn,
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

describe("a link that spans registers says which ones", () => {
  /**
   * THE ONE THAT WENT WRONG IN THE FIELD. A subject link is one link per
   * (teacher, subject) merging every class that teacher takes it for, so
   * Hemlata opened "Chemistry" and found eighty-four children with nothing —
   * not in the message, not on the screen — to say which of her three
   * registers any of them came from.
   */
  const chemistry = {
    kind: "subject" as const,
    label: "Chemistry — Hemlata",
    fieldKeys: ["fa_chemistry"],
  };

  it("names the classes instead of saying '(your classes)'", () => {
    const spanning = {
      ...chemistry,
      classLabels: ["Class 10", "Class 11 Science", "Class 12 Science"],
    };
    assert.equal(
      describeAudienceEn(spanning),
      "Chemistry — Class 10, Class 11 Science, Class 12 Science",
    );
    assert.match(describeAudienceHi(spanning), /Class 10, Class 11 Science/);
  });

  it("says nothing extra for a single class — the label already carries it", () => {
    assert.equal(
      describeAudienceEn({ ...chemistry, classLabels: ["Class 10"] }),
      "Chemistry (your classes)",
    );
  });

  it("counts them past a handful rather than listing nineteen", () => {
    // A house link is most of the school. Nineteen class names in a WhatsApp
    // bubble is a wall she scrolls past to reach the URL.
    const house = {
      kind: "house" as const,
      label: "Rana Pratap",
      classLabels: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6"],
    };
    assert.equal(describeAudienceEn(house), "Rana Pratap House — 6 classes");
  });

  it("leaves a class link alone", () => {
    // Repeating "Class 8" inside a message titled "Class 8" is noise.
    assert.equal(
      describeAudienceEn({
        kind: "class",
        label: "Class 8",
        classLabels: ["Class 8"],
      }),
      "Class 8",
    );
  });

  it("carries the classes into the message she actually receives", () => {
    const message = buildRequestMessage({
      ...base,
      audience: {
        ...chemistry,
        classLabels: ["Class 11 Science", "Class 12 Science"],
      },
    });
    assert.ok(message.includes("Class 11 Science, Class 12 Science"));
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

describe("buildRoundReminderMessage", () => {
  /**
   * One nudge per teacher, not per form.
   *
   * A teacher who takes maths for three classes used to get three Remind
   * buttons on the dashboard and therefore three near-identical WhatsApp
   * messages a few seconds apart. That is not three reminders — it is one
   * person spamming her, and the sensible response is to stop reading any.
   */
  const item = {
    audience: { kind: "class" as const, label: "Class 8" },
    title: "फ़ोन नंबर",
    dueDate: "2026-08-20",
    url: "https://x.invalid/r/a",
    answered: 0,
    rosterSize: 24,
  };

  it("delegates to buildReminderMessage, byte for byte, for a single form", () => {
    // The compatibility contract, the same one buildRoundMessage carries: most
    // teachers owe exactly one thing and must not notice anything changed.
    assert.equal(
      buildRoundReminderMessage({ teacherName: "Sunita", items: [item] }),
      buildReminderMessage({
        teacherName: "Sunita",
        audience: item.audience,
        title: item.title,
        dueDate: item.dueDate,
        url: item.url,
      }),
    );
  });

  it("sends her durable page ONCE instead of a link per form", () => {
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      teacherPageUrl: "https://x.invalid/t/abc",
      items: [
        { ...item, audience: { kind: "class", label: "Class 8" }, url: "https://x.invalid/r/a" },
        { ...item, audience: { kind: "class", label: "Class 9" }, url: "https://x.invalid/r/b" },
        { ...item, audience: { kind: "class", label: "Class 10" }, url: "https://x.invalid/r/c" },
      ],
    });

    assert.equal(
      (message.match(/https:\/\/x\.invalid/g) ?? []).length,
      1,
      "her page carries all three, so per-form links would be the wall this collapses",
    );
    assert.ok(message.includes("https://x.invalid/t/abc"));
    assert.ok(!message.includes("/r/a"), "a per-form link survived alongside her page");
  });

  it("falls back to one link per form when she has no page", () => {
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      items: [
        { ...item, audience: { kind: "class", label: "Class 8" }, url: "https://x.invalid/r/a" },
        { ...item, audience: { kind: "class", label: "Class 9" }, url: "https://x.invalid/r/b" },
      ],
    });
    assert.ok(message.includes("https://x.invalid/r/a"));
    assert.ok(message.includes("https://x.invalid/r/b"));
  });

  it("puts the deadline on the line it applies to", () => {
    // The one place this cannot copy buildRoundMessage: a reminder spans
    // whatever is outstanding, so a single "Due:" footer would be wrong for
    // every line but one.
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      items: [
        { ...item, dueDate: "2026-08-14", audience: { kind: "class", label: "Class 8" } },
        { ...item, dueDate: "2026-09-01", audience: { kind: "class", label: "Class 9" } },
      ],
    });
    assert.ok(message.includes("14 Aug"), "the first deadline is missing");
    assert.ok(message.includes("1 Sept"), "the second deadline is missing");
  });

  it("says how far along she is, rather than accusing her of not starting", () => {
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      items: [
        { ...item, answered: 20, rosterSize: 24, audience: { kind: "class", label: "Class 8" } },
        { ...item, answered: 0, rosterSize: 24, audience: { kind: "class", label: "Class 9" } },
      ],
    });
    assert.ok(message.includes("20 of 24 done"), "a teacher nearly finished was told nothing");
    assert.ok(message.includes("not started"));
  });

  it("names each group, in both languages, once per form", () => {
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      items: [
        { ...item, audience: { kind: "subject", label: "Maths", fieldKeys: ["fa_maths"] } },
        { ...item, audience: { kind: "class", label: "Class 9" } },
      ],
    });
    assert.ok(message.includes("Maths"), "the subject is not named");
    assert.ok(message.includes("गणित"), "the Hindi subject name is missing");
    assert.ok(message.includes("Class 9"));
  });

  it("keeps Devanagari numerals out, like every other teacher-facing string", () => {
    const message = buildRoundReminderMessage({
      teacherName: "Prateek",
      teacherPageUrl: "https://x.invalid/t/abc",
      items: [
        { ...item, answered: 20, audience: { kind: "class", label: "Class 8" } },
        { ...item, audience: { kind: "class", label: "Class 9" } },
      ],
    });
    assert.ok(!/[०-९]/.test(message), "Devanagari numerals reached a teacher");
  });
});

describe("teacherPageUrl", () => {
  it("is the one place the /t/ route is spelled", () => {
    assert.equal(teacherPageUrl("https://x.invalid", "abc"), "https://x.invalid/t/abc");
  });
});

/**
 * The status board, as a message.
 *
 * Build plan section 10 calls the board the enforcement mechanism and says the
 * headline is meant to be shared in the staff group. This is that headline,
 * plus who it is waiting on.
 */
describe("buildRoundStatusMessage", () => {
  const pending = {
    submitted: 8,
    total: 11,
    outstanding: [
      { label: "Class 7", answered: 0, rosterSize: 41 },
      { label: "Class 9 B", answered: 20, rosterSize: 24 },
    ],
  };

  it("leads with the sentence the build plan asks for", () => {
    const message = buildRoundStatusMessage(pending);
    assert.match(message, /^8 of 11 groups have submitted\./);
  });

  it("says it in Hindi too, like every other message here", () => {
    assert.match(buildRoundStatusMessage(pending), /11 में से 8 पूरी हो चुकी हैं।/);
  });

  it("names the groups still outstanding, never the teachers", () => {
    const message = buildRoundStatusMessage(pending);
    assert.match(message, /Class 7/);
    assert.match(message, /Class 9 B/);
  });

  it("separates 'not started' from 'nearly done'", () => {
    const message = buildRoundStatusMessage(pending);
    // A class at 20 of 24 listed flatly beside one at 0 of 41 would tell the
    // staff group something untrue about both.
    assert.match(message, /Class 7 — not started · अभी शुरू नहीं/);
    assert.match(message, /Class 9 B — 20 of 24 · 24 में से 20/);
  });

  it("agrees with itself when only one group is open", () => {
    const message = buildRoundStatusMessage({
      submitted: 0,
      total: 1,
      outstanding: [{ label: "Class 7", answered: 0, rosterSize: 41 }],
    });
    assert.match(message, /^0 of 1 group has submitted\./);
  });

  it("thanks the room rather than listing nobody when everything is in", () => {
    const message = buildRoundStatusMessage({
      submitted: 11,
      total: 11,
      outstanding: [],
    });
    assert.match(message, /Everything is in/);
    assert.doesNotMatch(message, /Still pending/);
  });

  it("keeps Devanagari numerals out, like every other message", () => {
    // Pinned to 0-9 across the app: "११ अगस्त" on a due date is unreadable.
    assert.doesNotMatch(buildRoundStatusMessage(pending), /[०-९]/);
  });
});
