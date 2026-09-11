import type {
  Audience,
  MissingField,
  StudentQuery,
  StudentSort,
} from "./students";

/**
 * The query string IS the filter state.
 *
 * That is an existing decision on this board and it is the right one — a
 * filtered view is a link the office can send itself, or keep as a bookmark for
 * the round it runs every term. This module is the one place that knows how a
 * URL and a StudentQuery correspond, so the board, the pagination links and the
 * Excel export cannot drift into disagreeing about what a link means.
 *
 * Before this, the export took `?class=` alone: filtering the board to a house
 * and then pressing Export handed you a different set of children than the one
 * on screen, with nothing to say so.
 */

export const SORTS: StudentSort[] = ["name", "class", "recent", "complete", "fullest", "id"];

/**
 * Every hole the board can filter on.
 *
 * ONE-WAY NOW, and it used to be a pair: every tracked field in
 * lib/completeness.ts still has a filter here, so every cell of the data-health
 * heatmap is a link — but not every filter here is a tracked field. The four
 * phone ones are not holes in a child's record, they are facts about the
 * numbers we already hold, and putting them in the completeness bar would move
 * five hundred children's scores for something the school does not consider
 * owed. `alt_phone` was already excluded over there for exactly that reason.
 */
export const MISSING_FIELDS: MissingField[] = [
  "phone",
  "photo",
  "aadhaar",
  "dob",
  "house",
  "route",
  "father",
  "mother",
  "gender",
  "category",
  "janAadhaar",
  "village",
  "altPhone",
  "onlyOnePhone",
  "samePhones",
  "notOnWhatsapp",
];

/**
 * The seven the "Work left" strip shows. The other nine exist as filters and,
 * where they are tracked fields, as heatmap cells; sixteen chips on a phone
 * above the board is a wall.
 */
export const QUICK_VIEW_FIELDS: MissingField[] = [
  "phone",
  "photo",
  "aadhaar",
  "dob",
  "house",
  "route",
  "father",
];

/** What each hole is called on screen. */
export const MISSING_LABELS: Record<MissingField, string> = {
  phone: "No mobile",
  photo: "No photo",
  aadhaar: "No Aadhaar",
  dob: "No date of birth",
  house: "No house",
  route: "No route",
  father: "No father's name",
  mother: "No mother's name",
  gender: "No gender",
  category: "No category",
  janAadhaar: "No Jan Aadhaar",
  village: "No village",
  altPhone: "No second number",
  onlyOnePhone: "Only one number",
  samePhones: "Both numbers the same",
  notOnWhatsapp: "Number not on WhatsApp",
};

/**
 * The same holes, as a teacher reads them.
 *
 * A gap name used to be read only by the office, so English was the whole of
 * it. Now a round can say WHY a child is on the list, and that sentence reaches
 * a WhatsApp message and the teacher's own screen — so each one needs a Hindi
 * half, and it needs exactly one home or the message and the screen will drift.
 * components/teacher/strings.ts reads these rather than restating them.
 *
 * Phrased as what is wanted rather than what is absent ("फ़ोटो बाकी है", not
 * "कोई फ़ोटो नहीं"): she is being given a job, not shown a deficiency. Feminine
 * throughout, like the rest of that surface, and Latin digits only.
 */
export const MISSING_LABELS_HI: Record<MissingField, string> = {
  phone: "मोबाइल नंबर बाकी है",
  photo: "फ़ोटो बाकी है",
  aadhaar: "आधार नंबर बाकी है",
  dob: "जन्म तिथि बाकी है",
  house: "सदन बाकी है",
  route: "बस मार्ग बाकी है",
  father: "पिता का नाम बाकी है",
  mother: "माता का नाम बाकी है",
  gender: "लिंग बाकी है",
  category: "श्रेणी बाकी है",
  janAadhaar: "जन आधार बाकी है",
  village: "गाँव बाकी है",
  altPhone: "दूसरा नंबर बाकी है",
  onlyOnePhone: "सिर्फ़ एक नंबर है, दूसरा बाकी है",
  samePhones: "दोनों नंबर एक ही हैं",
  notOnWhatsapp: "यह नंबर WhatsApp पर नहीं है",
};

export const SORT_LABELS: Record<StudentSort, string> = {
  name: "Name",
  class: "Class and roll",
  recent: "Recently updated",
  complete: "Least complete first",
  fullest: "Most complete first",
  id: "Student ID",
};

/** 250 is where a phone starts to struggle; there is no "all". */
export const PAGE_SIZES = [50, 100, 250];
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Multi-valued parameters are repeated (`?houses=A&houses=B`), which is what a
 * plain checkbox in a GET form produces with no JavaScript at all. A
 * comma-joined value would need encoding rules and would break on a route name
 * containing one.
 */
export type StudentSearchParams = Record<string, string | string[] | undefined>;

const many = (raw: string | string[] | undefined): string[] => {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => value.split(",")).map((v) => v.trim()).filter(Boolean);
};

const one = (raw: string | string[] | undefined): string =>
  (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

export type ParsedFilters = {
  query: StudentQuery;
  page: number;
  size: number;
  /** True when anything at all is narrowing the list. Drives the Clear link. */
  active: boolean;
};

export function parseFilters(params: StudentSearchParams): ParsedFilters {
  const size = PAGE_SIZES.includes(Number(one(params.size)))
    ? Number(one(params.size))
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Number(one(params.page)) || 1);

  const sortRaw = one(params.sort) as StudentSort;
  const sort = SORTS.includes(sortRaw) ? sortRaw : "name";

  // `class` (singular) is the name this board has always used and links to it
  // exist — in the request builder, in the student detail page, in whatever the
  // office has bookmarked. It keeps working and simply joins `classes`.
  const classes = [...many(params.classes), ...many(params.class)];

  const missing = many(params.missing).filter((value): value is MissingField =>
    (MISSING_FIELDS as string[]).includes(value),
  );

  const query: StudentQuery = {
    search: one(params.q),
    classes,
    sections: many(params.sections),
    houses: many(params.houses),
    routes: many(params.routes),
    genders: many(params.genders),
    categories: many(params.categories),
    villages: many(params.villages),
    statuses: many(params.statuses),
    missing,
    sort,
    limit: size,
    offset: (page - 1) * size,
  };

  const active =
    Boolean(query.search) ||
    classes.length > 0 ||
    query.sections!.length > 0 ||
    query.houses!.length > 0 ||
    query.routes!.length > 0 ||
    query.genders!.length > 0 ||
    query.categories!.length > 0 ||
    query.villages!.length > 0 ||
    query.statuses!.length > 0 ||
    missing.length > 0 ||
    sort !== "name";

  return { query, page, size, active };
}

/**
 * The same filters back into a URL, for pagination and for the export link.
 *
 * `page` is passed separately because every caller wants a different one, and
 * threading it through the query object would mean recomputing an offset that
 * is already known. `sort` likewise, for the column headers.
 */
export function toSearchParams(
  params: StudentSearchParams,
  overrides: { page?: number; sort?: StudentSort } = {},
): URLSearchParams {
  const search = new URLSearchParams();
  const carry = [
    "q",
    "class",
    "classes",
    "sections",
    "houses",
    "routes",
    "genders",
    "categories",
    "villages",
    "statuses",
    "missing",
    "sort",
    "size",
  ];

  for (const key of carry) {
    for (const value of many(params[key])) search.append(key, value);
  }
  // A header link re-sorts the SAME view: the filters carry, the page does
  // not, because page 3 of one order is nowhere in particular in another.
  if (overrides.sort) {
    search.delete("sort");
    if (overrides.sort !== "name") search.set("sort", overrides.sort);
  }
  if (overrides.page && overrides.page > 1) {
    search.set("page", String(overrides.page));
  }
  return search;
}

/**
 * Why these children and not the rest, in one clause.
 *
 * Used three times over and deliberately from one place: it is appended to the
 * audience line in a WhatsApp message (both languages), shown above the rows on
 * the teacher's own screen, and printed on the office's preview before anything
 * is created. Three renderings of one fact, which is exactly the sort of thing
 * that goes quietly out of step when each screen writes its own.
 *
 * Reads as "12 children: No photo" rather than a sentence, because the labels
 * are already how the office named the filter, and a translation layer between
 * the chip she clicked and the message that went out is a place for the two to
 * disagree. More than two holes at once is a selection nobody will read back,
 * so they are counted instead of listed.
 */
export function describeGaps(
  gaps: MissingField[],
  count: number,
  language: "en" | "hi" = "en",
): string | null {
  if (gaps.length === 0) return null;

  const labels = language === "hi" ? MISSING_LABELS_HI : MISSING_LABELS;
  const known = gaps.filter((gap) => gap in labels);
  if (known.length === 0) return null;

  const what =
    known.length <= 2
      ? known.map((gap) => labels[gap]).join(language === "hi" ? ", " : ", ")
      : language === "hi"
        ? `${known.length} जानकारियाँ बाकी हैं`
        : `${known.length} fields missing`;

  // Latin digits in both — a test asserts no Devanagari numeral reaches a
  // teacher, and the school reads roll numbers in Latin anyway.
  const who =
    language === "hi"
      ? `${count} ${count === 1 ? "बच्चा" : "बच्चे"}`
      : `${count} ${count === 1 ? "child" : "children"}`;

  return `${who}: ${what}`;
}

/**
 * A board URL, as an audience to send to.
 *
 * THE HOP FROM /students TO /requests/bulk, and the reason it goes through this
 * module rather than being assembled at the call site: the board filters on
 * nine dimensions and the send used to carry three, so "Class 8, category SC,
 * no photo" pressed Send became "Class 8, no photo" — a BIGGER set of children
 * than the one on screen, with nothing anywhere to say so. Every dimension
 * parseFilters understands is carried here, and audienceWhere resolves them
 * with the board's own predicate builder.
 *
 * `statuses` is deliberately NOT carried. The board may legitimately be
 * filtered to children who have left; a send never may, and audienceWhere
 * forces active regardless. Dropping it here as well means the screen never
 * shows a count that includes them.
 *
 * Returns null when the URL narrows nothing, so an unfiltered visit to the send
 * screen behaves exactly as it always has.
 */
export function audienceFromFilters(
  params: StudentSearchParams,
): Audience | null {
  const { query } = parseFilters(params);

  const audience: Audience = {
    search: query.search || undefined,
    classes: query.classes?.length ? query.classes : undefined,
    sections: query.sections?.length ? query.sections : undefined,
    houses: query.houses?.length ? query.houses : undefined,
    routes: query.routes?.length ? query.routes : undefined,
    genders: query.genders?.length ? query.genders : undefined,
    categories: query.categories?.length ? query.categories : undefined,
    villages: query.villages?.length ? query.villages : undefined,
    gaps: query.missing?.length ? query.missing : undefined,
  };

  return Object.values(audience).some(Boolean) ? audience : null;
}

/**
 * The carried filter, in the office's own words, for the line above the chips.
 *
 * Says the gaps first because that is what the office came here to act on, and
 * the count is the number that will actually be frozen — read from the server,
 * never arithmetic in the browser.
 */
export function describeAudienceFilters(audience: Audience): string {
  const parts: string[] = [];
  const named = (label: string, values?: string[]) => {
    if (values?.length) parts.push(`${label} ${values.join(", ")}`);
  };

  if (audience.gaps?.length) {
    parts.push(audience.gaps.map((gap) => MISSING_LABELS[gap]).join(" + "));
  }
  named("Class", audience.classes);
  named("Section", audience.sections);
  named("House", audience.houses);
  named("Route", audience.routes);
  named("Gender", audience.genders);
  named("Category", audience.categories);
  named("Village", audience.villages);
  if (audience.search) parts.push(`matching "${audience.search}"`);

  return parts.join(" · ");
}
