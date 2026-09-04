/**
 * WhatsApp message template builder.
 *
 * These are the messages the office copies and sends from its own WhatsApp.
 * The API path — lib/whatsapp-templates.ts, lib/aisensy.ts — sends Meta-
 * approved templates instead, and can only fill numbered holes; it reuses the
 * audience wording and the date formatting from here so the two read alike.
 * The manual path is never removed: it is the fallback when the API is off,
 * refuses a number, or a template is paused.
 *
 * MESSAGES ARE BILINGUAL, ENGLISH LINE OVER HINDI LINE, matching the screen
 * the link opens. They used to be Hindi-only, and a Hindi message that opens an
 * English screen is worse than either on its own — the words she is told to
 * press have to be the words she then sees, which is why the how-to now quotes
 * "Correct" and "Change" inside its Hindi sentence rather than translating them.
 *
 * The pairing is line-by-line, not block-by-block: an English paragraph
 * followed by a Hindi paragraph makes her scroll past three lines to find hers.
 */

import { HOUSES } from "./houses";
import {
  MAX_NAMED_INLINE,
  MAX_NAMED_TOTAL,
  namesFor,
  type PendingStudent,
} from "./pending";
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
  /**
   * Every class the link's roster actually covers, in timetable order.
   *
   * A class link needs none — its label already is the class. A SUBJECT link
   * does: one link per (teacher, subject) merges every class that teacher takes
   * it for, so Hemlata opened "Chemistry" and found eighty-four children with
   * nothing to say which of her three registers any of them came from. Same for
   * a house or a route, which span the school by definition.
   *
   * Read off the frozen roster, so the message cannot name a class the screen
   * does not show. See classesByRequest in lib/requests.ts.
   */
  classLabels?: string[];
};

/**
 * The classes worth naming out loud.
 *
 * Nothing for a class link — repeating "Class 8" inside a message titled
 * "Class 8" is noise. Nothing for one class either, for the same reason the
 * label already carries it. Two or more is the case that was silently broken.
 */
function spannedClasses(audience: MessageAudience): string[] {
  if (audience.kind === "class") return [];
  const labels = audience.classLabels ?? [];
  return labels.length > 1 ? labels : [];
}

/**
 * Beyond a handful, the count is more use than the list.
 *
 * A subject link is two to four classes and naming them is the whole point. A
 * house link is most of the school, and nineteen class names in a WhatsApp
 * message is a wall she will scroll past to reach the URL.
 */
const MAX_NAMED_CLASSES = 5;

function describeClasses(labels: string[], word: string): string {
  return labels.length <= MAX_NAMED_CLASSES
    ? labels.join(", ")
    : `${labels.length} ${word}`;
}

export type RequestMessageInput = {
  teacherName: string;
  audience: MessageAudience;
  title: string;
  dueDate: Date | string;
  url: string;
};

/**
 * "5 Sep", in the school's zone. Exported because lib/whatsapp-templates.ts
 * fills the same hole in the API templates, and two formatters for one date
 * is how a reminder and its template disagree about which day is due.
 */
export function formatDue(due: Date | string): string {
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
    if (!subject) return audience.label;
    const classes = spannedClasses(audience);
    return classes.length > 0
      ? `${subject.hi} — ${describeClasses(classes, "कक्षाएँ")}`
      : `${subject.hi} (आपकी कक्षाएँ)`;
  }
  return audience.label;
}

/**
 * How the group reads in the English half of the same sentence.
 *
 * A class label already says "Class 8", so it is left alone; the other kinds
 * need the noun that names what they are, exactly as the Hindi side does.
 * EVERY KIND IS EXPLICIT here for the reason the Hindi one is: a fallback that
 * names a kind would announce the next kind added as that one, silently.
 */
export function describeAudienceEn(audience: MessageAudience): string {
  if (audience.kind === "class") return audience.label;
  if (audience.kind === "house" || audience.kind === "route") {
    const noun = audience.kind === "house" ? "House" : "route";
    const classes = spannedClasses(audience);
    return classes.length > 0
      ? `${audience.label} ${noun} — ${describeClasses(classes, "classes")}`
      : `${audience.label} ${noun}`;
  }
  if (audience.kind === "subject") {
    const subject = audience.fieldKeys
      ?.map((key) => subjectByFieldKey(key))
      .find(Boolean);
    if (!subject) return audience.label;
    // "(your classes)" was true and useless — it told her the link was hers and
    // not which registers to fetch. Name them when there is more than one.
    const classes = spannedClasses(audience);
    return classes.length > 0
      ? `${subject.en} — ${describeClasses(classes, "classes")}`
      : `${subject.en} (your classes)`;
  }
  return audience.label;
}

/** The sign-off, both halves, on one line. */
const SIGN_OFF = "— Veer Patta School office · वीर पत्ता विद्यालय कार्यालय";

/**
 * The how-to, said once per message.
 *
 * The button names are NOT translated. She is being told which words to look
 * for, and the words on the screen are "Correct" and "Change".
 */
const HOW_TO = [
  `The list opens at the link below. Press "Correct" where it is right, or "Change" to fix it.`,
  `नीचे दिए लिंक पर सूची खुलेगी — जो सही है उस पर "Correct" दबाएँ, गलत हो तो "Change" दबाकर ठीक कर दें।`,
];

/**
 * How the children still missing are described to the teacher.
 *
 * `pending` is THREE-STATE and every state is a different sentence:
 *   undefined -> the caller never looked. Say nothing, which is what every
 *                reminder said before this existed.
 *   null      -> the caller looked and the list is not worth carrying (past
 *                NAME_LIST_CEILING, or it did not fit the message's budget).
 *                Say the count.
 *   an array  -> the full list. Name them, truncated at the cap.
 *
 * Collapsing undefined and null into one would make a reminder claim "24
 * children are still left" on a screen that never counted them, which is the
 * kind of confident wrong number the office would rightly stop trusting.
 */
export type PendingInput = {
  /** Children still unanswered for. Needed to say the count when names are not shown. */
  outstanding?: number;
  pending?: PendingStudent[] | null;
};

/** The count on its own, when the names are not worth listing. */
function outstandingLines(outstanding: number): string[] {
  return [
    `${outstanding} ${outstanding === 1 ? "student is" : "students are"} still left · ${outstanding} ${outstanding === 1 ? "बच्चा" : "बच्चे"} अभी बाकी ${outstanding === 1 ? "है" : "हैं"}।`,
  ];
}

/**
 * One child, as she reads them off the register.
 *
 * The roll number leads because that is the column she scans; a name with no
 * roll still reads fine without one. The class is appended ONLY for a link whose
 * roster spans registers — the same condition spannedClasses uses, and for the
 * same reason: a subject link is eighty-four children from three books, and a
 * bare name does not say which.
 */
function namePart(student: PendingStudent, spansClasses: boolean): string {
  const roll = student.rollNo === null ? "" : `${student.rollNo}. `;
  const where =
    spansClasses && student.classLabel ? ` (${student.classLabel})` : "";
  return `${roll}${student.name}${where}`;
}

function spansRegisters(audience: MessageAudience): boolean {
  return audience.kind !== "class";
}

/**
 * Who is still missing, rendered — and how much of the budget that cost.
 *
 * ONE FUNCTION FOR BOTH SHAPES AND FOR THE ACCOUNTING, which is the only way the
 * two can be guaranteed to agree. This started as three functions — a block, an
 * inline line, and a "how many did that spend" — and the third had to re-derive
 * the first two's decision from the same inputs. Two of them taking different
 * caps would have silently over-reported the spend and starved the next item.
 *
 * TWO SHAPES ON PURPOSE, and the precedent is describeAudienceLineHi above: a
 * lone link and a line among three are different reading problems, and this file
 * already keeps two renderings for exactly that reason.
 *
 *   block  — one name per line, under a reminder about a single list. Roll
 *            numbers align down the left and it reads against a register.
 *   inline — names run together on one wrapped line, for one item among several,
 *            where three vertical lists would be the wall that
 *            one-message-per-person exists to prevent.
 */
function renderPending(
  input: PendingInput,
  audience: MessageAudience,
  budget: number,
  shape: "block" | "inline",
): { lines: string[]; spent: number } {
  const nothing = { lines: [] as string[], spent: 0 };
  const outstanding = input.outstanding ?? input.pending?.length ?? 0;
  if (input.pending === undefined || outstanding === 0) return nothing;

  if (shape === "inline") {
    // Whole list or nothing: a slice of a longer one is an arbitrary subset, and
    // the progress line directly above already says "20 of 45 done".
    if (outstanding > MAX_NAMED_INLINE) return nothing;
    const names = namesFor(
      outstanding,
      input.pending,
      budget,
      MAX_NAMED_INLINE,
    );
    if (names === null) return nothing;

    const listed = names
      .map((student) => namePart(student, spansRegisters(audience)))
      .join(", ");
    return {
      lines: [`   still to fill · भरना बाकी: ${listed}`],
      spent: names.length,
    };
  }

  const names = namesFor(outstanding, input.pending, budget);
  // Looked, and found too many to be worth listing. The count is the useful fact.
  if (names === null) return { lines: outstandingLines(outstanding), spent: 0 };

  const spans = spansRegisters(audience);
  // The header carries the ASK as well as the count — "please fill these in" is
  // the whole point of the message, and it costs nothing on a line that has to
  // carry the number anyway.
  const lines = [
    `${outstanding} ${outstanding === 1 ? "student is" : "students are"} left — please fill these in:`,
    `${outstanding} ${outstanding === 1 ? "बच्चा" : "बच्चे"} बाकी ${outstanding === 1 ? "है" : "हैं"} — इनकी जानकारी भर दें:`,
    ...names.map((student) => namePart(student, spans)),
  ];

  const rest = outstanding - names.length;
  if (rest > 0) lines.push(`…and ${rest} more · और ${rest}`);
  return { lines, spent: names.length };
}

/** The initial "please fill this" message. */
export function buildRequestMessage(input: RequestMessageInput): string {
  const due = formatDue(input.dueDate);
  const lines = [
    `Namaste ${input.teacherName},`,
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    `Please check ${input.title} for ${describeAudienceEn(input.audience)}.`,
    `${describeAudienceHi(input.audience)} के लिए ${input.title} की जाँच करनी है।`,
    ``,
    ...HOW_TO,
    ``,
    input.url,
    ``,
    `Due: ${due} · अंतिम तिथि: ${due}`,
  ];

  lines.push(``, SIGN_OFF);
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

/** The same, in English. What the teacher's durable page shows. */
export function describeAudienceLine(audience: MessageAudience): string {
  if (audience.kind === "subject") {
    const subject = audience.fieldKeys
      ?.map((key) => subjectByFieldKey(key))
      .find(Boolean);
    if (subject) return subject.en;
  }
  return describeAudienceEn(audience);
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
  const due = formatDue(input.dueDate);
  const lines = [
    `Namaste ${input.teacherName},`,
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    ...(count === 1
      ? [`Please check ${input.title}.`, `${input.title} की जाँच करनी है।`]
      : [
          `Please check ${input.title}. You have ${count} links — each opens a different list.`,
          `${input.title} की जाँच करनी है। आपके ${count} लिंक हैं — हर एक की सूची अलग है।`,
        ]),
    ``,
  ];

  // The group name carries both halves on ONE numbered line, separated by a
  // dot, rather than on two. Everywhere else the pairing is line over line;
  // here, at three links, doubling the line count is exactly the wall this
  // message shape exists to avoid.
  input.links.forEach((link, index) => {
    const en = describeAudienceLine(link.audience);
    const hi = describeAudienceLineHi(link.audience);
    lines.push(`${index + 1}) ${en}${hi === en ? "" : ` · ${hi}`}`);
    lines.push(link.url);
    lines.push(``);
  });

  lines.push(
    `Every link opens its own list. Press "Correct" where it is right, or "Change" to fix it.`,
    `हर लिंक में सूची खुलेगी — जो सही है उस पर "Correct" दबाएँ, गलत हो तो "Change" दबाकर ठीक कर दें।`,
    ``,
    `Due: ${due} · अंतिम तिथि: ${due}`,
  );

  if (input.teacherPageUrl) {
    lines.push(
      ``,
      `From now on all your links live in one place. Save this:`,
      `आगे से आपके सारे लिंक एक ही जगह मिलेंगे। इसे सहेज लें:`,
      input.teacherPageUrl,
    );
  }

  lines.push(``, SIGN_OFF);
  return lines.join("\n");
}

/** One outstanding form on a reminder that carries several. */
export type ReminderItem = {
  audience: MessageAudience;
  title: string;
  dueDate: Date | string;
  /** This one request's link. Only used when she has no durable page. */
  url: string;
  /** How far along she is, for the "5 of 24 done" half-line. */
  answered: number;
  rosterSize: number;
  /**
   * Who on this list is still missing. Three-state — see PendingInput.
   *
   * `outstanding` is not carried separately here because this type already has
   * both halves of it: rosterSize - answered.
   */
  pending?: PendingStudent[] | null;
};

export type RoundReminderInput = {
  teacherName: string;
  items: ReminderItem[];
  /** Her durable page. When she has one it REPLACES every per-form link. */
  teacherPageUrl?: string;
};

/**
 * Everything one teacher still owes, in ONE message.
 *
 * A teacher who teaches maths to three classes had three rows on the dashboard
 * and therefore three Remind buttons, which sent her three near-identical
 * WhatsApp messages within about four seconds of each other. From her end that
 * is not three reminders, it is one person spamming her — and the natural
 * response to it is to stop reading any of them. The office also had no way to
 * see that it had just done so, because each row only knew about itself.
 *
 * ONE LINK DELEGATES, byte for byte, exactly as buildRoundMessage does and for
 * the same reason: most teachers owe exactly one form and must keep receiving
 * the message they always have. There is a test on that equality.
 *
 * PER-ITEM DUE DATES, which is the one place this cannot follow
 * buildRoundMessage. That builder describes a single round, so it carries one
 * title and one deadline for the lot. A reminder spans whatever happens to be
 * outstanding — an FA round due Friday and a phone check that was due last
 * week — so the deadline belongs on the line it applies to, and a single "Due:"
 * footer would be wrong for every line but one.
 *
 * PROGRESS IS ON THE LINE because "still pending" is not the same fact as
 * "half done", and a teacher who has entered twenty of twenty-four needs to be
 * told that rather than accused of not having started.
 */
export function buildRoundReminderMessage(input: RoundReminderInput): string {
  if (input.items.length === 1 && !input.teacherPageUrl) {
    const only = input.items[0]!;
    return buildReminderMessage({
      teacherName: input.teacherName,
      audience: only.audience,
      title: only.title,
      dueDate: only.dueDate,
      url: only.url,
      // Passed through, or the byte-for-byte contract below would hold only for
      // the nameless case and most of the staff would silently keep the old
      // message. There is a test on the equality WITH names for that reason.
      outstanding: Math.max(0, only.rosterSize - only.answered),
      pending: only.pending,
    });
  }

  const count = input.items.length;
  /**
   * Spent down the list, whole items at a time — see namesFor.
   *
   * Items arrive in due-date order (groupProgressByTeacher sorts them), so the
   * thing she is latest on is the thing that gets named.
   */
  let budget = MAX_NAMED_TOTAL;
  const lines = [
    `Namaste ${input.teacherName},`,
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    ...(count === 1
      ? [`This is still pending:`, `यह अभी बाकी है:`]
      : [
          `${count} lists are still pending:`,
          `आपकी ${count} सूचियाँ अभी बाकी हैं:`,
        ]),
    ``,
  ];

  input.items.forEach((item, index) => {
    const en = describeAudienceLine(item.audience);
    const hi = describeAudienceLineHi(item.audience);
    const due = formatDue(item.dueDate);
    const named = renderPending(
      {
        outstanding: Math.max(0, item.rosterSize - item.answered),
        pending: item.pending,
      },
      item.audience,
      budget,
      "inline",
    );
    lines.push(`${index + 1}) ${en}${hi === en ? "" : ` · ${hi}`} — ${item.title}`);
    lines.push(`   ${progressLine(item)} · due ${due} · अंतिम तिथि ${due}`);
    lines.push(...named.lines);
    budget -= named.spent;
    // Her durable page carries all of them, so a per-form link underneath it
    // would be the same wall of links this message exists to collapse.
    if (!input.teacherPageUrl) lines.push(item.url);
    lines.push(``);
  });

  if (input.teacherPageUrl) {
    lines.push(
      `All of them are on your page:`,
      `ये सब आपके पेज पर हैं:`,
      input.teacherPageUrl,
      ``,
    );
  }

  lines.push(SIGN_OFF);
  return lines.join("\n");
}

/** "not started" / "12 of 24 done", in both languages on one line. */
function progressLine(item: ReminderItem): string {
  if (item.rosterSize === 0 || item.answered === 0) {
    return `not started · अभी शुरू नहीं`;
  }
  return `${item.answered} of ${item.rosterSize} done · ${item.rosterSize} में से ${item.answered} हो गए`;
}

/**
 * The nudge for teachers who have not submitted yet.
 *
 * NAMES THE CHILDREN WHO ARE LEFT when the caller has looked them up. Saying
 * only "still pending" made her open the link and hunt for the four cards she
 * skipped, with the app holding the answer the whole time. See PendingInput for
 * why not looking and finding too many are different states.
 *
 * The block sits between the sentence and the URL so the link stays the last
 * thing in the bubble — it is what she has to tap, and a list scrolling past it
 * would bury it.
 */
export function buildReminderMessage(
  input: RequestMessageInput & PendingInput,
): string {
  const due = formatDue(input.dueDate);
  const { lines: names } = renderPending(
    input,
    input.audience,
    MAX_NAMED_TOTAL,
    "block",
  );
  return [
    `Namaste ${input.teacherName},`,
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    `${input.title} for ${describeAudienceEn(input.audience)} is still pending. It is due ${due}.`,
    `${describeAudienceHi(input.audience)} की ${input.title} अभी बाकी है। अंतिम तिथि ${due} है।`,
    ``,
    ...(names.length > 0 ? [...names, ``] : []),
    input.url,
    ``,
    SIGN_OFF,
  ].join("\n");
}

/**
 * Her durable page, as a URL.
 *
 * Three files were building this string inline — the dashboard, the send queue
 * and the teacher settings panel — which is three places to remember if the
 * route ever moves, and three chances for one of them to hand out a URL that
 * 404s. It is one line, and it being one line is exactly why it kept getting
 * retyped rather than imported.
 */
export function teacherPageUrl(origin: string, token: string): string {
  return `${origin}/t/${token}`;
}

export type RoundStatusInput = {
  /** Groups whose frozen roster is fully answered for. */
  submitted: number;
  /** Every open group in the round. */
  total: number;
  /**
   * The groups still outstanding, in the order the board shows them, each with
   * how far along it is.
   */
  outstanding: { label: string; answered: number; rosterSize: number }[];
};

/**
 * The status board, as something that can be posted in the staff group.
 *
 * Section 10 of the build plan is blunt about why this exists: "The status
 * board is the enforcement mechanism. Share '8 of 11 classes submitted' in the
 * staff group. Nobody wants to be in the 3." The board has rendered that
 * sentence since it was written — as text, on a screen, which the office then
 * screenshotted or retyped.
 *
 * IT NAMES GROUPS, NOT TEACHERS, and that is the build plan's own framing
 * ("8 of 11 classes"). Everyone in a staff group knows whose class is whose, so
 * nothing is lost as a nudge; what is avoided is a list of colleagues' names
 * posted under a heading about who has not done their work. The per-teacher
 * chase already exists one tap away, addressed to her alone.
 *
 * Progress rides on each line for the reason it does in the reminder: a class
 * at 20 of 24 is nearly done, and listing it flatly beside one at 0 of 41 tells
 * the room something untrue about both.
 *
 * There is no sign-off asking anyone to reply, because this is an announcement
 * to a room rather than a message to a person.
 */
export function buildRoundStatusMessage(input: RoundStatusInput): string {
  const { submitted, total, outstanding } = input;

  const lines = [
    `${submitted} of ${total} ${total === 1 ? "group has" : "groups have"} submitted.`,
    `${total} में से ${submitted} पूरी हो चुकी हैं।`,
  ];

  if (outstanding.length === 0) {
    lines.push(``, `Everything is in. Thank you.`, `सब आ गया है। धन्यवाद।`);
    return lines.join("\n");
  }

  lines.push(``, `Still pending:`, `अभी बाकी:`, ``);
  for (const group of outstanding) {
    lines.push(
      `• ${group.label} — ${
        group.rosterSize === 0 || group.answered === 0
          ? `not started · अभी शुरू नहीं`
          : `${group.answered} of ${group.rosterSize} · ${group.rosterSize} में से ${group.answered}`
      }`,
    );
  }

  lines.push(``, SIGN_OFF);
  return lines.join("\n");
}

/** A click-to-chat link that opens WhatsApp with the message pre-filled. */
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

/**
 * Opening a chat with a PARENT, from the child's page.
 *
 * Not a request and not a reminder: the office rings or messages a family
 * about one child — a fee, a form, a number that bounced — and the app's part
 * is only to open the right chat with the school named and the child named, so
 * the parent knows who is writing before the office types the rest.
 *
 * English line over Hindi line, like every other message here.
 */
export function buildParentMessage(input: { name: string; classLabel: string }): string {
  const who = `${input.name} (${input.classLabel})`;
  return [
    `Namaste. This is Veer Patta School, Amet, about ${who}.`,
    `नमस्ते। वीर पत्ता विद्यालय, आमेट से ${who} के बारे में।`,
  ].join("\n");
}
