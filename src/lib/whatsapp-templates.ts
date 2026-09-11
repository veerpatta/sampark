/**
 * The AiSensy template messages: their text, and the parameters that fill them.
 *
 * lib/whatsapp.ts writes a free-form message the office pastes into WhatsApp
 * by hand. A message sent through the WhatsApp Business API is not free-form:
 * it is a template Meta approved in advance, with numbered holes, and the app
 * may only supply the values for the holes. That changes three things, and
 * this file exists to hold all three in one place:
 *
 *   - THE TEXT IS FIXED AT APPROVAL. `TEMPLATE_TEXT` below is the exact body,
 *     footer and button of each template, so the settings screen can print
 *     what to paste into AiSensy and a test can assert the builders fill every
 *     hole and no more. A template edited in the dashboard without editing
 *     this file sends the wrong number of params, and AiSensy refuses it —
 *     that refusal is the safety net, and this file is what keeps it from
 *     being hit.
 *   - ONE LANGUAGE PER TEMPLATE. Meta rejects a Hindi body with English lines
 *     in it, so "English line over Hindi line" cannot be carried across. Each
 *     template exists twice, and the teacher's own `language` picks one. The
 *     two button words she has to press stay in Latin script in BOTH, for the
 *     reason HOW_TO in lib/whatsapp.ts gives: the words on the screen are
 *     "Correct" and "Change", and she is being told what to look for.
 *   - A PARAM IS ONE LINE. No newline, no tab, no run of spaces — Meta rejects
 *     the message otherwise. So the children still to fill in ride inside a
 *     single summary line, comma-joined, the way the inline shape of
 *     renderPending already does for a reminder covering several lists.
 *
 * THE BUTTON CARRIES A BARE TOKEN, NEVER A PATH. The URL base is baked into the
 * approved template, and whether a "/" survives inside a button variable is a
 * question about Meta's implementation that costs six re-approvals to get
 * wrong. So the template's button is `…/w/{{n}}`, the value is the sixteen
 * characters of the token, and src/app/w/[token] works out whether it names a
 * request or a teacher's page. See suffixFor for which token goes in.
 *
 * THE TOKEN IS NOT ONE OF THE PARAMS. AiSensy numbers a URL button's variable
 * on its own (the dashboard shows it as {{1}} whatever the body holds), and its
 * campaign API refuses a call that puts the button value at the end of
 * `templateParams` — "Template params does not match the campaign". The body
 * values go in `params`; the token goes in `suffix`, which lib/aisensy.ts
 * sends as a `buttons` entry. Verified against the live campaign on
 * 2026-09-04, which is why this comment is here.
 *
 * PURE, AND WITH NO DATABASE IMPORT, like lib/whatsapp.ts and lib/pending.ts —
 * the settings screen and the send buttons are client components and reach
 * this module. The API key and the HTTP call live in lib/aisensy.ts, which
 * nothing in the browser bundle may import.
 */

import {
  MAX_NAMED_INLINE,
  MAX_NAMED_TOTAL,
  namesFor,
  type PendingStudent,
} from "./pending";
import {
  describeAudienceLine,
  describeAudienceLineHi,
  formatDue,
  sharedReason,
  stripReason,
  type MessageAudience,
} from "./whatsapp";

/* ============ LANGUAGES ============ */

export const LANGUAGES = ["hi", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Hindi, because that is the language most of the staff read WhatsApp in. */
export const DEFAULT_LANGUAGE: Language = "hi";

export function isLanguage(value: unknown): value is Language {
  return value === "hi" || value === "en";
}

/** "Hindi" / "English", for a settings screen. */
export const LANGUAGE_LABEL: Record<Language, string> = {
  hi: "Hindi",
  en: "English",
};

/* ============ THE TEMPLATES ============ */

export const TEMPLATE_KINDS = ["request", "reminder", "link"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/**
 * Where every button points. The token is appended.
 *
 * The production domain, not the request's host: the office may be creating a
 * round from a preview deployment or from localhost, but the template was
 * approved with this one URL in it and the teacher's phone opens that.
 * Moving the app to another domain means re-creating every template — this
 * constant is the reminder of that, and the settings screen prints it.
 */
export const TEMPLATE_BUTTON_BASE = "https://sampark-theta-eight.vercel.app/w/";

/**
 * The suffix a test send carries. /w/test renders a one-line page rather than
 * redirecting anywhere, so the office can prove the button works before any
 * teacher receives one.
 */
export const TEST_SUFFIX = "test";

export type TemplateSpec = {
  /** The template's name in AiSensy, and the API campaign's name. */
  name: string;
  category: "UTILITY";
  language: Language;
  /** Meta's language code for the dashboard's dropdown. */
  languageCode: "hi" | "en";
  /** The body, with {{n}} holes. Newlines are real newlines. */
  body: string;
  footer: string;
  button: { text: string; url: string };
  /** One sample per hole, in order — the dashboard asks for them at approval. */
  samples: string[];
};

/** `sampark_request_hi` and friends. The API campaign is named the same. */
export function templateName(kind: TemplateKind, language: Language): string {
  return `sampark_${kind}_${language}`;
}

const SIGN_OFF: Record<Language, string> = {
  en: "Veer Patta School office",
  hi: "वीर पत्ता विद्यालय कार्यालय",
};

const OPEN_LIST: Record<Language, string> = {
  en: "Open the list",
  hi: "सूची खोलें",
};

/**
 * The six templates, verbatim.
 *
 * Variables are numbered in order of APPEARANCE in each language, which is what
 * Meta requires, so the Hindi request puts the title before the group where
 * the English one does too. The builders fill them by position, and a test
 * asserts every builder produces exactly `expectedParamCount` values.
 */
export const TEMPLATE_TEXT: Record<TemplateKind, Record<Language, TemplateSpec>> = {
  request: {
    en: {
      name: templateName("request", "en"),
      category: "UTILITY",
      language: "en",
      languageCode: "en",
      body: [
        "Namaste {{1}} ji,",
        "",
        'Please check {{2}} for {{3}}. Press "Correct" where it is right, or "Change" to fix it. Due: {{4}}.',
        "",
        "Tap the button below to open the list.",
      ].join("\n"),
      footer: SIGN_OFF.en,
      button: { text: OPEN_LIST.en, url: `${TEMPLATE_BUTTON_BASE}{{5}}` },
      samples: ["Sunita Sharma", "FA1 marks", "Class 8", "5 Sep", "AbCdEfGhIjKlMnOp"],
    },
    hi: {
      name: templateName("request", "hi"),
      category: "UTILITY",
      language: "hi",
      languageCode: "hi",
      body: [
        "नमस्ते {{1}} जी,",
        "",
        '{{2}} की जाँच करनी है — {{3}}। जो सही है उस पर "Correct" दबाएँ, गलत हो तो "Change" दबाकर ठीक कर दें। अंतिम तिथि: {{4}}।',
        "",
        "नीचे दिए बटन से सूची खुलेगी।",
      ].join("\n"),
      footer: SIGN_OFF.hi,
      button: { text: OPEN_LIST.hi, url: `${TEMPLATE_BUTTON_BASE}{{5}}` },
      samples: ["Sunita Sharma", "FA1 marks", "कक्षा Class 8", "5 Sep", "AbCdEfGhIjKlMnOp"],
    },
  },
  reminder: {
    en: {
      name: templateName("reminder", "en"),
      category: "UTILITY",
      language: "en",
      languageCode: "en",
      body: [
        "Namaste {{1}} ji,",
        "",
        "This is still pending: {{2}}",
        "",
        "Tap the button below to open it. Thank you.",
      ].join("\n"),
      footer: SIGN_OFF.en,
      button: { text: OPEN_LIST.en, url: `${TEMPLATE_BUTTON_BASE}{{3}}` },
      samples: [
        "Sunita Sharma",
        "FA1 marks · Class 8 — 12 of 40 done, still to fill: 3. Aarav Meena, 7. Priya Sharma — due 5 Sep",
        "AbCdEfGhIjKlMnOp",
      ],
    },
    hi: {
      name: templateName("reminder", "hi"),
      category: "UTILITY",
      language: "hi",
      languageCode: "hi",
      body: [
        "नमस्ते {{1}} जी,",
        "",
        "यह अभी बाकी है: {{2}}",
        "",
        "नीचे दिए बटन से खोलें। धन्यवाद।",
      ].join("\n"),
      footer: SIGN_OFF.hi,
      button: { text: OPEN_LIST.hi, url: `${TEMPLATE_BUTTON_BASE}{{3}}` },
      samples: [
        "Sunita Sharma",
        "FA1 marks · कक्षा Class 8 — 40 में से 12 हो गए, भरना बाकी: 3. Aarav Meena, 7. Priya Sharma — अंतिम तिथि 5 Sep",
        "AbCdEfGhIjKlMnOp",
      ],
    },
  },
  link: {
    en: {
      name: templateName("link", "en"),
      category: "UTILITY",
      language: "en",
      languageCode: "en",
      body: [
        "Namaste {{1}} ji,",
        "",
        "Whatever the school asks for will appear on your personal page from now on. Save this message and open the page from the button below.",
      ].join("\n"),
      footer: SIGN_OFF.en,
      button: { text: "Open my page", url: `${TEMPLATE_BUTTON_BASE}{{2}}` },
      samples: ["Sunita Sharma", "AbCdEfGhIjKlMnOp"],
    },
    hi: {
      name: templateName("link", "hi"),
      category: "UTILITY",
      language: "hi",
      languageCode: "hi",
      body: [
        "नमस्ते {{1}} जी,",
        "",
        "विद्यालय जो भी जानकारी माँगेगा, वह अब आपके निजी पेज पर दिखेगी। यह संदेश सहेज लें और नीचे दिए बटन से पेज खोलें।",
      ].join("\n"),
      footer: SIGN_OFF.hi,
      button: { text: "मेरा पेज खोलें", url: `${TEMPLATE_BUTTON_BASE}{{2}}` },
      samples: ["Sunita Sharma", "AbCdEfGhIjKlMnOp"],
    },
  },
};

/** Every template, flat, in the order the dashboard should be worked through. */
export function allTemplates(): TemplateSpec[] {
  return TEMPLATE_KINDS.flatMap((kind) =>
    LANGUAGES.map((language) => TEMPLATE_TEXT[kind][language]),
  );
}

/**
 * How many values `templateParams` carries: every {{n}} in the BODY. The
 * button's token is sent separately (see the header). Derived from the text
 * rather than written down, so the two cannot disagree.
 */
export function expectedParamCount(kind: TemplateKind, language: Language = "en"): number {
  const spec = TEMPLATE_TEXT[kind][language];
  const holes = new Set(spec.body.match(/\{\{\d+\}\}/g) ?? []);
  return holes.size;
}

/* ============ PARAMS ============ */

/**
 * The longest a single value may be.
 *
 * Meta caps the RENDERED body at 1024 characters. The fixed text of the
 * longest template is under 200, so a summary of 700 leaves room; the other
 * values are short by construction and the cap is only a guard.
 */
export const SUMMARY_MAX = 700;
export const PARAM_MAX = 200;

/**
 * One line, one space between words, and a length.
 *
 * A newline or a tab in a value is an outright rejection from Meta; four or
 * more consecutive spaces is too. Collapsing every run of whitespace to one
 * space covers both without a second rule to remember.
 */
export function sanitiseParam(value: string, max = PARAM_MAX): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** One API call: which campaign, and the values for its holes. */
export type TemplatePayload = {
  kind: TemplateKind;
  language: Language;
  /** The body's values, in hole order. Never the token — see the header. */
  params: string[];
  /** The token the button carries. Sent as the button's own parameter. */
  suffix: string;
  /** Every request this one message covers, for the tick. */
  requestIds: string[];
};

/* ============ WHICH TOKEN THE BUTTON CARRIES ============ */

export type LinkForSuffix = {
  requestId: string;
  token: string;
  fieldKeys: string[];
};

/**
 * What NEVER_ON_TEACHER_PAGE in lib/auth/token.ts keeps off the durable page.
 *
 * Duplicated here rather than imported, because that module imports the
 * database and this one may be reached from the browser. A test pins the two
 * sets equal, so the duplication cannot drift silently.
 */
export const NEVER_ON_TEACHER_PAGE_KEYS: ReadonlySet<string> = new Set([
  "aadhaar",
  "jan_aadhaar",
  "dob",
  "photo",
]);

export function isListableOnTeacherPageKeys(fieldKeys: string[]): boolean {
  return !fieldKeys.some((key) => NEVER_ON_TEACHER_PAGE_KEYS.has(key));
}

/**
 * How one card becomes messages.
 *
 *   page   — she has a durable page and every link on the card may appear on
 *            it: ONE message, the button opens her page, which lists them all.
 *   single — one link, no usable page: ONE message, the button opens that link.
 *   split  — several links and no page that may carry them (an Aadhaar round,
 *            a photo round): one message PER LINK, because a template has one
 *            button and each link has its own token.
 *
 * The third case is the one that has to be explicit. Folding it into "single"
 * would quietly send the first link and drop the rest; folding it into "page"
 * would put a photo round on a page the rule says it must never reach.
 */
export type SuffixPlan =
  | { mode: "page"; suffix: string; requestIds: string[] }
  | { mode: "single"; suffix: string; requestIds: string[] }
  | { mode: "split"; messages: { suffix: string; requestIds: string[]; link: LinkForSuffix }[] };

export function suffixFor(
  links: LinkForSuffix[],
  linkToken: string | null,
): SuffixPlan {
  const ids = links.map((link) => link.requestId);
  if (
    linkToken &&
    links.length > 0 &&
    links.every((link) => isListableOnTeacherPageKeys(link.fieldKeys))
  ) {
    return { mode: "page", suffix: linkToken, requestIds: ids };
  }
  if (links.length === 1) {
    return { mode: "single", suffix: links[0]!.token, requestIds: ids };
  }
  return {
    mode: "split",
    messages: links.map((link) => ({
      suffix: link.token,
      requestIds: [link.requestId],
      link,
    })),
  };
}

/** How many API calls a card costs. What the card says before sending. */
export function messageCount(links: LinkForSuffix[], linkToken: string | null): number {
  const plan = suffixFor(links, linkToken);
  return plan.mode === "split" ? plan.messages.length : 1;
}

/* ============ REQUEST ============ */

export type RequestPayloadLink = LinkForSuffix & {
  audience: MessageAudience;
};

export type RequestPayloadInput = {
  teacherName: string;
  language: Language;
  title: string;
  dueDate: Date | string;
  links: RequestPayloadLink[];
  /** Her durable page token, or null. */
  linkToken: string | null;
};

function audienceText(audience: MessageAudience, language: Language): string {
  return language === "hi"
    ? describeAudienceLineHi(audience)
    : describeAudienceLine(audience);
}

/**
 * "Class 8", or "3 lists: 1) Class 8 · 2) Class 9 · 3) Maths — Class 10".
 *
 * One template serves both the lone link and the round of several, exactly
 * as buildRoundMessage delegates to buildRequestMessage: the difference is
 * what this one value says, not which template is sent.
 */
function whatToCheck(links: RequestPayloadLink[], language: Language): string {
  if (links.length === 1) return audienceText(links[0]!.audience, language);

  // Every link in a round shares one reason, so it is named once at the end
  // rather than repeated on each of three numbered lines — which for an
  // office's typed sentence would be three copies of a paragraph.
  const shared = sharedReason(
    links.map((link) => link.audience),
    language,
  );
  const listed = links
    .map(
      (link, index) =>
        `${index + 1}) ${audienceText(shared ? stripReason(link.audience) : link.audience, language)}`,
    )
    .join(" · ");
  const head =
    language === "hi"
      ? `${links.length} सूचियाँ: ${listed}`
      : `${links.length} lists: ${listed}`;
  return shared ? `${head} — ${shared}` : head;
}

/** The "please check this" message — one, or one per link. See suffixFor. */
export function buildRequestPayloads(input: RequestPayloadInput): TemplatePayload[] {
  const due = formatDue(input.dueDate);
  const plan = suffixFor(input.links, input.linkToken);

  const one = (links: RequestPayloadLink[], suffix: string, requestIds: string[]): TemplatePayload => ({
    kind: "request",
    language: input.language,
    params: [
      sanitiseParam(input.teacherName),
      sanitiseParam(input.title),
      sanitiseParam(whatToCheck(links, input.language), SUMMARY_MAX),
      sanitiseParam(due),
    ],
    suffix,
    requestIds,
  });

  if (plan.mode === "split") {
    return plan.messages.map((message) =>
      one([message.link as RequestPayloadLink], message.suffix, message.requestIds),
    );
  }
  return [one(input.links, plan.suffix, plan.requestIds)];
}

/* ============ REMINDER ============ */

export type ReminderPayloadItem = LinkForSuffix & {
  audience: MessageAudience;
  title: string;
  dueDate: Date | string;
  answered: number;
  rosterSize: number;
  /** Who is still missing. Three-state — see PendingInput in lib/whatsapp.ts. */
  pending?: PendingStudent[] | null;
};

export type ReminderPayloadInput = {
  teacherName: string;
  language: Language;
  /** Oldest deadline first, as groupProgressByTeacher sorts them. */
  items: ReminderPayloadItem[];
  linkToken: string | null;
};

/** "12 of 40 done" / "not started", in one language. */
function progressText(item: ReminderPayloadItem, language: Language): string {
  const started = item.rosterSize > 0 && item.answered > 0;
  if (language === "hi") {
    return started
      ? `${item.rosterSize} में से ${item.answered} हो गए`
      : "अभी शुरू नहीं";
  }
  return started ? `${item.answered} of ${item.rosterSize} done` : "not started";
}

/**
 * One child, as she reads them off the register: roll number first, and the
 * class only when the list spans more than one register. The same shape as
 * namePart in lib/whatsapp.ts, for the same reasons.
 */
function nameText(student: PendingStudent, spansRegisters: boolean): string {
  const roll = student.rollNo === null ? "" : `${student.rollNo}. `;
  const where = spansRegisters && student.classLabel ? ` (${student.classLabel})` : "";
  return `${roll}${student.name}${where}`;
}

/**
 * The names still to fill in, or nothing — and what that cost the budget.
 *
 * The inline rule from renderPending, verbatim: the whole list or none of it,
 * never a slice, and never past MAX_NAMED_INLINE. The count already sits in the
 * progress text directly before it, so "nothing" is never uninformative.
 */
function namesText(
  item: ReminderPayloadItem,
  budget: number,
  language: Language,
): { text: string; spent: number } {
  const outstanding = Math.max(0, item.rosterSize - item.answered);
  if (item.pending === undefined || outstanding === 0) return { text: "", spent: 0 };
  if (outstanding > MAX_NAMED_INLINE) return { text: "", spent: 0 };
  const names = namesFor(outstanding, item.pending, budget, MAX_NAMED_INLINE);
  if (names === null) return { text: "", spent: 0 };

  const spans = item.audience.kind !== "class";
  const listed = names.map((student) => nameText(student, spans)).join(", ");
  const label = language === "hi" ? "भरना बाकी" : "still to fill";
  return { text: `, ${label}: ${listed}`, spent: names.length };
}

/**
 * One list, on one line: "FA1 marks · Class 8 — 12 of 40 done, still to
 * fill: 3. Aarav, 7. Priya — due 5 Sep".
 */
function itemSummary(
  item: ReminderPayloadItem,
  budget: number,
  language: Language,
): { text: string; spent: number } {
  const due = formatDue(item.dueDate);
  const names = namesText(item, budget, language);
  const dueLabel = language === "hi" ? "अंतिम तिथि" : "due";
  return {
    text: `${item.title} · ${audienceText(item.audience, language)} — ${progressText(item, language)}${names.text} — ${dueLabel} ${due}`,
    spent: names.spent,
  };
}

/**
 * Everything she still owes, in one value — or one message per link when the
 * round is one her durable page may not carry. See suffixFor.
 *
 * The budget is spent down the list whole items at a time, exactly as
 * buildRoundReminderMessage spends it: items arrive oldest-deadline-first, so
 * the thing she is latest on is the thing that gets named.
 */
export function buildReminderPayloads(input: ReminderPayloadInput): TemplatePayload[] {
  const plan = suffixFor(input.items, input.linkToken);

  const one = (items: ReminderPayloadItem[], suffix: string, requestIds: string[]): TemplatePayload => {
    let budget = MAX_NAMED_TOTAL;
    const parts = items.map((item) => {
      const summary = itemSummary(item, budget, input.language);
      budget -= summary.spent;
      return summary.text;
    });
    const summary =
      parts.length === 1
        ? parts[0]!
        : `${parts.length} ${input.language === "hi" ? "सूचियाँ" : "lists"}: ${parts
            .map((part, index) => `${index + 1}) ${part}`)
            .join("; ")}`;
    return {
      kind: "reminder",
      language: input.language,
      params: [
        sanitiseParam(input.teacherName),
        sanitiseParam(summary, SUMMARY_MAX),
      ],
      suffix,
      requestIds,
    };
  };

  if (plan.mode === "split") {
    return plan.messages.map((message) =>
      one([message.link as ReminderPayloadItem], message.suffix, message.requestIds),
    );
  }
  return [one(input.items, plan.suffix, plan.requestIds)];
}

/* ============ LINK ============ */

/** Her durable page, handed over. Always one message; there is one page. */
export function buildLinkPayload(input: {
  teacherName: string;
  language: Language;
  linkToken: string;
}): TemplatePayload {
  return {
    kind: "link",
    language: input.language,
    params: [sanitiseParam(input.teacherName)],
    suffix: input.linkToken,
    requestIds: [],
  };
}

/* ============ TEST ============ */

/**
 * A request message with invented values and the test suffix, so the office
 * can prove the campaign, the params and the button all line up before any
 * teacher receives one. No token, no request, no tick.
 */
export function buildTestPayload(language: Language): TemplatePayload {
  const spec = TEMPLATE_TEXT.request[language];
  // The last sample is the button's; it is not a param.
  const samples = spec.samples.slice(0, -1);
  return {
    kind: "request",
    language,
    params: samples,
    suffix: TEST_SUFFIX,
    requestIds: [],
  };
}

/**
 * The body as a teacher would read it, for a preview on screen. Not what is
 * sent — AiSensy renders the approved template itself — but the same text.
 */
export function renderPreview(payload: TemplatePayload): string {
  const spec = TEMPLATE_TEXT[payload.kind][payload.language];
  const body = spec.body.replace(/\{\{(\d+)\}\}/g, (_match, n: string) => {
    return payload.params[Number(n) - 1] ?? "";
  });
  return `${body}\n\n${spec.footer}\n[${spec.button.text}] ${TEMPLATE_BUTTON_BASE}${payload.suffix}`;
}
