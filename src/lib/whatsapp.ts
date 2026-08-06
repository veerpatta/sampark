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

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export type MessageAudience = {
  kind: string;
  label: string;
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
 */
export function describeAudienceHi(audience: MessageAudience): string {
  if (audience.kind === "house") {
    const house = HOUSES.find((row) => row.name === audience.label);
    return `${house?.hi ?? audience.label} सदन`;
  }
  if (audience.kind === "route") return `${audience.label} रूट`;
  return `कक्षा ${audience.label}`;
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
