/**
 * WhatsApp message template builder.
 *
 * v1 is copy-paste only: the admin copies the message and sends it from their
 * own WhatsApp. Automated sending via AiSensy is a later phase and only after
 * the manual flow is proven (SAMPARK_BUILD_PLAN.md section 11).
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

import { titleCaseName } from "./classes";
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
    });
  }

  const count = input.items.length;
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
    lines.push(`${index + 1}) ${en}${hi === en ? "" : ` · ${hi}`} — ${item.title}`);
    lines.push(`   ${progressLine(item)} · due ${due} · अंतिम तिथि ${due}`);
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

/** The nudge for teachers who have not submitted yet. */
export function buildReminderMessage(input: RequestMessageInput): string {
  const due = formatDue(input.dueDate);
  return [
    `Namaste ${input.teacherName},`,
    `नमस्ते ${input.teacherName} जी,`,
    ``,
    `${input.title} for ${describeAudienceEn(input.audience)} is still pending. It is due ${due}.`,
    `${describeAudienceHi(input.audience)} की ${input.title} अभी बाकी है। अंतिम तिथि ${due} है।`,
    ``,
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
  /**
   * The round this is about, when it is about one.
   *
   * OPTIONAL, AND ABSENT IS THE OLD BEHAVIOUR BYTE FOR BYTE. The dashboard's
   * Share button covers everything currently open — several rounds at once —
   * and has no single title or deadline to name. The round page does, and a
   * status message posted in the staff group with no idea what it is about
   * makes the room guess. There is a test on the equality.
   */
  title?: string;
  dueDate?: Date | string;
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

  const lines: string[] = [];
  // The heading, when this message is about one named round. A blank line
  // after it, so the count still reads as the headline rather than as a
  // subtitle of the title.
  if (input.title) {
    lines.push(input.title, ``);
  }
  lines.push(
    `${submitted} of ${total} ${total === 1 ? "group has" : "groups have"} submitted.`,
    `${total} में से ${submitted} पूरी हो चुकी हैं।`,
  );

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

  // Only on the round-scoped version, and only where there is still something
  // outstanding — a deadline announced under "Everything is in" is a date
  // nobody has to do anything about.
  if (input.dueDate) {
    const due = formatDue(input.dueDate);
    lines.push(``, `Due: ${due} · अंतिम तिथि: ${due}`);
  }

  lines.push(``, SIGN_OFF);
  return lines.join("\n");
}

/* ------------------------------------------------------- who is still missing */

/**
 * One child who has not been answered for.
 *
 * STRUCTURAL, AND DELIBERATELY NOT AN IMPORT of MissingStudent from
 * lib/requests.ts. This module is imported by "use client" components — the
 * send queue, the chase queue, the share panel — and lib/requests.ts imports
 * lib/db.ts, which its own header says must never reach the browser bundle.
 * The two types are the same shape and a MissingStudent satisfies this one
 * without either file knowing about the other.
 */
export type MissingChild = {
  /** Null for a child with no roll number on the frozen roster. */
  rollNo: number | null;
  name: string;
};

/**
 * How one child reads in a list a teacher is meant to work through.
 *
 * Roll number first, because that is the order her register is in and the
 * number is how she finds the child in it. A child without one gets the name
 * alone rather than a leading separator — "· Aarav Sharma" reads as a mistake,
 * and on the real data most children have no roll number at all.
 *
 * TITLE-CASED, AND THAT IS NOT COSMETIC. 483 of the school's 504 names are
 * stored in capitals because that is how the fee app took them, and
 * titleCaseName runs at RENDER everywhere else in the app for the reason its
 * own header gives: a screen shouting ANSHUL KUMAWAT reads as an error message.
 * A WhatsApp message is render. Without this every one of these lists arrives
 * on a teacher's phone in block capitals.
 *
 * lib/classes.ts imports nothing at all, so pulling it in here costs the four
 * client components that import this module nothing.
 */
function childLine(child: MissingChild): string {
  const name = titleCaseName(child.name);
  return child.rollNo === null ? `• ${name}` : `• ${child.rollNo} · ${name}`;
}

export type GroupMissingInput = {
  audience: MessageAudience;
  /** The round's title, as the office typed it — "Student photos". */
  title: string;
  dueDate: Date | string;
  answered: number;
  rosterSize: number;
  /** In register order. See missingFromRoster in lib/requests.ts. */
  students: MissingChild[];
};

/**
 * One group's outstanding children, by name and roll number.
 *
 * THE MESSAGE THAT ACTUALLY PRODUCES PHOTOGRAPHS. The status board tells a room
 * that Class 8 is at eighteen of twenty-four; it does not tell the one person
 * who can fix that WHICH six children she has left, which is the only fact she
 * needs and the one she would otherwise get by squinting at a screen in the
 * office and writing them down.
 *
 * NO GREETING AND NO NAME, because this is not necessarily addressed to a
 * person. It is written to be pasted either to the class teacher or into that
 * class's own group, and a message opening "Namaste Sunita ji" pasted into a
 * group of forty parents is addressed to the wrong room.
 *
 * NO LINK, AND THAT IS THE SAFETY PROPERTY. A request token opens the whole
 * class roster to whoever holds it — /requests/[id] already says so out loud —
 * and this message is built to be forwarded. The office chases the teacher with
 * her link privately, using the reminder; this one carries names and roll
 * numbers and nothing else. No phone number, no parent's name, no field of any
 * other kind.
 */
export function buildGroupMissingMessage(input: GroupMissingInput): string {
  const due = formatDue(input.dueDate);
  const left = input.students.length;

  const lines = [
    `${describeAudienceEn(input.audience)} — ${input.title}`,
    `${describeAudienceHi(input.audience)} — ${input.title}`,
    ``,
  ];

  if (input.answered === 0) {
    lines.push(
      `Not started. All ${left} are still to come:`,
      `अभी शुरू नहीं। सभी ${left} बाकी हैं:`,
    );
  } else {
    lines.push(
      `${input.answered} of ${input.rosterSize} done. ${
        left === 1 ? "This one is" : `These ${left} are`
      } still to come:`,
      `${input.rosterSize} में से ${input.answered} हो गए। ${
        left === 1 ? "यह एक" : `ये ${left}`
      } अभी बाकी ${left === 1 ? "है" : "हैं"}:`,
    );
  }

  lines.push(``, ...input.students.map(childLine));
  lines.push(``, `Due: ${due} · अंतिम तिथि: ${due}`, ``, SIGN_OFF);
  return lines.join("\n");
}

/**
 * Beyond this many, a group gets its count instead of its children.
 *
 * A class at eighteen of twenty-four needs its six naming; a class at nought of
 * thirty-one needs its teacher to open the link, and thirty-one names in front
 * of her says nothing the count did not. Between those two is a judgement, and
 * twenty is where a list stops being something you read and starts being
 * something you scroll past on a 360px screen. It comfortably covers the case
 * the office described — thirty to forty children left across a whole round,
 * which is a handful per class.
 */
export const MAX_NAMED_CHILDREN = 20;

export type RoundMissingInput = {
  title: string;
  dueDate: Date | string;
  /** In the order the board shows them. Finished groups are already dropped. */
  groups: {
    audience: MessageAudience;
    answered: number;
    rosterSize: number;
    students: MissingChild[];
  }[];
};

/**
 * The whole round's outstanding children, under group headings.
 *
 * The office asked for this one directly: one message, posted once, saying
 * exactly who is left across every class. It is the per-group message above,
 * repeated, with a headline and one deadline.
 *
 * IT DOES NOT NAME CHILDREN IN A GROUP THAT HAS NOT STARTED, and that is what
 * keeps a five-hundred-child round from producing a message nobody reaches the
 * end of. A group nobody has touched gets the counts line the status board
 * uses; so does one with more than MAX_NAMED_CHILDREN outstanding. Nothing is
 * hidden by this — the headline still counts every missing child, and the group
 * is still listed by name — but the message stays something a person reads
 * rather than scrolls.
 *
 * NAMES IN A ROOM ARE A DECISION THE OFFICE MAKES, NOT THIS FILE. The status
 * message deliberately names groups and not teachers, because a list of
 * colleagues under a heading about unfinished work is a different act from a
 * count. Children are different again — a class list is not a secret, and the
 * whole point is that somebody recognises a name and fetches that child — but
 * it is still the reason the screen offering this message says which group to
 * paste it into. Names and roll numbers only, as above.
 */
export function buildRoundMissingMessage(input: RoundMissingInput): string {
  const due = formatDue(input.dueDate);
  const missing = input.groups.reduce(
    (sum, group) => sum + group.students.length,
    0,
  );
  const children = input.groups.reduce(
    (sum, group) => sum + group.rosterSize,
    0,
  );

  const lines = [
    input.title,
    ``,
    `${missing} of ${children} still to come, across ${input.groups.length} ${
      input.groups.length === 1 ? "group" : "groups"
    }.`,
    `${children} में से ${missing} अभी बाकी हैं — ${input.groups.length} ${
      input.groups.length === 1 ? "समूह" : "समूहों"
    } में।`,
    ``,
  ];

  for (const group of input.groups) {
    const en = describeAudienceLine(group.audience);
    const hi = describeAudienceLineHi(group.audience);
    const left = group.students.length;
    const named = group.answered > 0 && left <= MAX_NAMED_CHILDREN;

    lines.push(
      `${en}${hi === en ? "" : ` · ${hi}`} — ${
        group.answered === 0
          ? `not started, all ${left} · अभी शुरू नहीं, सभी ${left}`
          : `${left} left of ${group.rosterSize} · ${group.rosterSize} में से ${left} बाकी`
      }`,
    );
    if (named) lines.push(...group.students.map(childLine));
    lines.push(``);
  }

  lines.push(`Due: ${due} · अंतिम तिथि: ${due}`, ``, SIGN_OFF);
  return lines.join("\n");
}

/** A click-to-chat link that opens WhatsApp with the message pre-filled. */
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
