import type { MissingField, StudentQuery, StudentSort } from "./students";

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

export const SORTS: StudentSort[] = ["name", "class", "recent", "complete"];

export const MISSING_FIELDS: MissingField[] = [
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
};

export const SORT_LABELS: Record<StudentSort, string> = {
  name: "Name",
  class: "Class and roll",
  recent: "Recently updated",
  complete: "Least complete first",
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
 * is already known.
 */
export function toSearchParams(
  params: StudentSearchParams,
  overrides: { page?: number } = {},
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
  if (overrides.page && overrides.page > 1) {
    search.set("page", String(overrides.page));
  }
  return search;
}
