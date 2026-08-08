/**
 * WhatsApp message template builder.
 *
 * v1 is copy-paste only: the admin copies the message and sends it from their
 * own WhatsApp. Automated sending via AiSensy is a later phase and only after
 * the manual flow is proven (SAMPARK_BUILD_PLAN.md section 11).
 *
 * Messages are Hindi-first — the teacher-facing surface always is.
 */

import { HOUSES } from "./houses";
import { subjectByFieldKey } from "./subjects";

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export type MessageAudience = {
  kind: string;
  label: string;
  /**
   * The request's field keys, for a subject link.
   *
   * A subject link asks about exactly one fa_* field, and that key is what names
   * the subject in Hindi. Parsing it back out of `label` would be a guess about
   * a string assembled for the office's boards ("Maths — Prakash Bunkar"), not
   * for a teacher — and the teacher's message is the delivery mechanism.
   */
  fieldKeys?: string[];
};

export type RequestMessageInput = {
  teacherName: string;
  audience: MessageAudience;
  title: string;
  dueDate: Date | string;
  url: string;
};

function formatDue(due: Date | string): string {
  return DATE_FMT.format(typeof due === "string" ? new Date(due) : due);
}

/**
 * How the group reads inside a Hindi sentence.
 *
 * Houses have a Hindi name and are worth using — every child knows them. Bus
 * routes are place names off the route master and stay in Latin script: a
 * transliteration nobody uses is harder to recognise than the name on the bus.
 *
 * EVERY KIND IS EXPLICIT and the fallback names none of them. This used to end
 * `return \`कक्षा ${label}\``, so `class` was the default — which meant the
 * first kind added after it was announced to a teacher as a class, silently, in
 * the one message that actually reaches her. A subject link would have read
 * "कक्षा Maths — Prakash Bunkar".
 */
export function describeAudienceHi(audience: MessageAudience): string {
  if (audience.kind === "class") return `कक्षा ${audience.label}`;
  if (audience.kind === "house") {
    const house = HOUSES.find((row) => row.name === audience.label);
    return `${house?.hi ?? audience.label} सदन`;
  }
  if (audience.kind === "route") return `${audience.label} रूट`;
  if (audience.kind === "subject") {
    const subject = audience.fieldKeys
      ?.map((key) => subjectByFieldKey(key))
      .find(Boolean);
    // She already knows which classes she teaches; the subject is the fact that
    // tells her which of her three links this one is.
    return subject ? `${subject.hi} (आपकी कक्षाएँ)` : audience.label;
  }
  return audience.label;
}

/** The initial "please fill this" message. */
export function buildRequestMessage(input: RequestMessageInput): string {
  const lines = [
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    `${describeAudienceHi(input.audience)} के लिए ${input.title} की जाँच करनी है।`,
    `नीचे दिए लिंक पर सूची खुलेगी — जो सही है उस पर "सही है" दबाएँ, गलत हो तो "बदलें" दबाकर ठीक कर दें।`,
    ``,
    input.url,
    ``,
    `अंतिम तिथि: ${formatDue(input.dueDate)}`,
  ];

  lines.push(``, `— वीर पत्ता विद्यालय कार्यालय`);
  return lines.join("\n");
}

/** One group's line in a message that carries several. */
export type RoundLink = {
  audience: MessageAudience;
  url: string;
};

export type RoundMessageInput = {
  teacherName: string;
  title: string;
  dueDate: Date | string;
  links: RoundLink[];
  /**
   * Her durable page, when she has one.
   *
   * Appended as a trailer so the first delivery of /t/<token> costs no extra
   * message — it rides along with a round she is about to do anyway, which is
   * the only moment she will actually save it. A standalone "here is your
   * permanent link" sent on a quiet Tuesday gets scrolled past.
   */
  teacherPageUrl?: string;
};

/**
 * How ONE group reads as a numbered line among several.
 *
 * Identical to describeAudienceHi for every kind except `subject`, where the
 * "(आपकी कक्षाएँ)" that disambiguates a lone subject link becomes three
 * redundant words per line once every line in the message is hers.
 */
export function describeAudienceLineHi(audience: MessageAudience): string {
  if (audience.kind === "subject") {
    const subject = audience.fieldKeys
      ?.map((key) => subjectByFieldKey(key))
      .find(Boolean);
    if (subject) return subject.hi;
  }
  return describeAudienceHi(audience);
}

/**
 * Everything one teacher has to do this round, in one message.
 *
 * A marks round is thirty-eight links but only about sixteen teachers, and
 * handing them over one at a time is thirty-eight app switches for work that is
 * really sixteen conversations. This is what collapses them.
 *
 * ONE LINK DELEGATES, byte for byte. Thirteen of those sixteen teachers have a
 * single link and must keep receiving exactly the message they always have —
 * there is a test on that equality, because a shape nobody reviewed reaching
 * most of the staff is the way this change could go wrong quietly.
 *
 * The how-to appears ONCE, not per link. Repeating "सही है / बदलें" three times
 * is what turns three links into a wall on a 360px screen.
 *
 * Each URL sits on its own line, which is what makes WhatsApp linkify it, with
 * a blank line between entries so the block does not read as one paragraph.
 * Latin digits for the numbering — Devanagari numerals were removed from every
 * teacher-facing string and a test asserts none reappear.
 */
export function buildRoundMessage(input: RoundMessageInput): string {
  if (input.links.length === 1 && !input.teacherPageUrl) {
    const only = input.links[0]!;
    return buildRequestMessage({
      teacherName: input.teacherName,
      audience: only.audience,
      title: input.title,
      dueDate: input.dueDate,
      url: only.url,
    });
  }

  const count = input.links.length;
  const lines = [
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    count === 1
      ? `${input.title} की जाँच करनी है।`
      : `${input.title} की जाँच करनी है। आपके ${count} लिंक हैं — हर एक की सूची अलग है।`,
    ``,
  ];

  input.links.forEach((link, index) => {
    lines.push(`${index + 1}) ${describeAudienceLineHi(link.audience)}`);
    lines.push(link.url);
    lines.push(``);
  });

  lines.push(
    `हर लिंक में सूची खुलेगी — जो सही है उस पर "सही है" दबाएँ, गलत हो तो "बदलें" दबाकर ठीक कर दें।`,
    ``,
    `अंतिम तिथि: ${formatDue(input.dueDate)}`,
  );

  if (input.teacherPageUrl) {
    lines.push(
      ``,
      `आगे से आपके सारे लिंक एक ही जगह मिलेंगे। इसे सहेज लें:`,
      input.teacherPageUrl,
    );
  }

  lines.push(``, `— वीर पत्ता विद्यालय कार्यालय`);
  return lines.join("\n");
}

/** The nudge for teachers who have not submitted yet. */
export function buildReminderMessage(input: RequestMessageInput): string {
  return [
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    `${describeAudienceHi(input.audience)} की ${input.title} अभी बाकी है। अंतिम तिथि ${formatDue(input.dueDate)} है।`,
    ``,
    input.url,
    ``,
    `— वीर पत्ता विद्यालय कार्यालय`,
  ].join("\n");
}

/** A click-to-chat link that opens WhatsApp with the message pre-filled. */
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
