import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "./db";
import { compareClassLabels, compareStudentNames } from "./classes";
import { COMPLETENESS_COLUMNS } from "./completeness";
import type { Student } from "../../drizzle/schema";

/** Server-side reads over the master record. Never imported by a client component. */

/**
 * Every way the office can narrow the school down.
 *
 * OR WITHIN A DIMENSION, AND ACROSS THEM — the same reading `Audience` uses
 * below, and the one the office means by "classes 6 to 8, Rana Pratap house".
 *
 * `missing` is the dimension that does real work. The whole job is closing
 * holes, and "show me every child with no mobile number" is the question that
 * turns a five-hundred-row table into a work list.
 */
export type MissingField =
  | "phone"
  | "photo"
  | "aadhaar"
  | "dob"
  | "house"
  | "route"
  | "father"
  | "mother"
  | "gender"
  | "category"
  | "janAadhaar"
  | "village"
  // The four below are holes of a different shape — see MISSING_COLUMNS.
  | "altPhone"
  | "onlyOnePhone"
  | "samePhones"
  | "notOnWhatsapp";

export type StudentSort = "name" | "class" | "recent" | "complete" | "fullest" | "id";

export type StudentQuery = {
  search?: string;
  classes?: string[];
  sections?: string[];
  houses?: string[];
  routes?: string[];
  genders?: string[];
  categories?: string[];
  villages?: string[];
  /**
   * Which record statuses to include.
   *
   * Undefined means ACTIVE ONLY, which is a change: this query used to filter
   * on status not at all, so the board silently listed the children who had
   * left alongside the ones who are here. Pass an explicit list — including
   * every value — to see them.
   */
  statuses?: string[];
  missing?: MissingField[];
  sort?: StudentSort;
  limit?: number;
  offset?: number;
};

/**
 * What each hole IS, as SQL.
 *
 * This used to be `Record<MissingField, AnyPgColumn>` and `buildWhere` wrote the
 * one predicate itself, because for twelve fields a hole was always the same
 * thing: that column is blank. Three of the four added since are not that shape
 * — "only one number" is a conjunction across two columns, "both the same" is a
 * comparison between them — so the registry holds the predicate rather than the
 * column, and the twelve original entries say `blank(...)` and mean exactly what
 * they always did.
 *
 * `column` is still carried where there is one, because lib/data-health.ts and
 * COMPLETENESS_COLUMNS index by it. The four new specs have no tracked column
 * and simply omit it; see the note on MISSING_FIELDS in lib/student-filters.ts
 * for why that no longer breaks the heatmap's invariant.
 */
type GapSpec = {
  /** The tracked column, when this hole is one column being empty. */
  column?: AnyPgColumn;
  where: () => SQL;
};

/**
 * An empty string is a hole too. Imports have produced both, and a filter that
 * finds only the NULLs quietly under-reports the work left.
 */
const blank = (column: AnyPgColumn): GapSpec => ({
  column,
  where: () => sql`nullif(btrim(${column}::text), '') is null`,
});

const filled = (column: AnyPgColumn): SQL =>
  sql`nullif(btrim(${column}::text), '') is not null`;

const MISSING_COLUMNS: Record<MissingField, GapSpec> = {
  phone: blank(schema.students.phone),
  photo: blank(schema.students.photoPath),
  aadhaar: blank(schema.students.aadhaar),
  dob: blank(schema.students.dob),
  house: blank(schema.students.house),
  route: blank(schema.students.busRoute),
  father: blank(schema.students.fatherName),
  mother: blank(schema.students.motherName),
  gender: blank(schema.students.gender),
  category: blank(schema.students.category),
  janAadhaar: blank(schema.students.janAadhaar),
  village: blank(schema.students.village),

  /** No second number at all — includes children with no number whatsoever. */
  altPhone: blank(schema.students.altPhone),

  /**
   * A number, but no fallback. Narrower than `altPhone` on purpose: this is the
   * "she did not pick up and there is nobody else to ring" list, and a child
   * with no number at all belongs on the `phone` list instead.
   */
  onlyOnePhone: {
    where: () =>
      sql`${filled(schema.students.phone)} and nullif(btrim(${schema.students.altPhone}::text), '') is null`,
  },

  /**
   * Two numbers that are the same number. The second one looks like a fallback
   * on every screen in this app and is not one, which is the whole reason this
   * is worth a filter rather than an eyeball.
   */
  samePhones: {
    where: () =>
      sql`${filled(schema.students.phone)} and btrim(${schema.students.phone}) = btrim(${schema.students.altPhone})`,
  },

  /**
   * Checked, and it is not on WhatsApp. NOT "we have never checked" — those are
   * almost every row, and sweeping them in here would bury the thirty-odd the
   * office actually knows about.
   */
  notOnWhatsapp: {
    where: () => sql`${schema.students.phoneOnWhatsapp} = 'no'`,
  },
};

export async function listStudents(query: StudentQuery): Promise<{
  students: Student[];
  total: number;
}> {
  const where = buildWhere(query);
  const limit = query.limit ?? 100;

  const [students, [count]] = await Promise.all([
    db
      .select()
      .from(schema.students)
      .where(where)
      .orderBy(...orderFor(query.sort))
      .limit(limit)
      .offset(query.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.students)
      .where(where),
  ]);

  return { students, total: count?.total ?? 0 };
}

/**
 * How the list reads down the screen.
 *
 * Name, not roll number, is the default: the PSP export has no roll numbers and
 * every row carries null, which made the old ordering arbitrary. See
 * compareStudentNames.
 *
 * `complete` sorts the emptiest records first, which is the only sort that
 * answers "who should the next request be about". It counts the same twelve
 * fields the bar in each row draws — one list, in lib/completeness.ts, so the
 * order and the bar can never disagree.
 */
function orderFor(sort: StudentSort = "name"): SQL[] {
  const byName = [
    asc(schema.students.classLabel),
    asc(schema.students.name),
  ] as unknown as SQL[];

  if (sort === "class") {
    return [
      asc(schema.students.classLabel),
      asc(schema.students.rollNo),
      asc(schema.students.name),
    ] as unknown as SQL[];
  }
  if (sort === "recent") {
    return [desc(schema.students.updatedAt)] as unknown as SQL[];
  }
  if (sort === "complete") {
    return [sql`(${completenessExpr()}) asc`, asc(schema.students.name)] as unknown as SQL[];
  }
  // The same number the other way up: the children whose records are already
  // whole, which is who a certificate round or an ID-card print wants first.
  if (sort === "fullest") {
    return [sql`(${completenessExpr()}) desc`, asc(schema.students.name)] as unknown as SQL[];
  }
  if (sort === "id") {
    return [asc(schema.students.id)] as unknown as SQL[];
  }
  return byName;
}

/** How many of the twelve tracked fields this row holds, as SQL. */
function completenessExpr(): SQL {
  return sql.join(
    COMPLETENESS_COLUMNS.map(
      (column) =>
        sql`(case when nullif(btrim(${sql.identifier(column)}::text), '') is null then 0 else 1 end)`,
    ),
    sql` + `,
  );
}

export function buildWhere(query: StudentQuery): SQL | undefined {
  const clauses: SQL[] = [];

  const search = query.search?.trim();
  if (search) {
    const like = `%${search}%`;
    // Name is searchable but never a MATCH key — see rule 7. Finding a child by
    // name is fine; deciding which record to overwrite by name is not.
    clauses.push(
      or(
        ilike(schema.students.name, like),
        ilike(schema.students.id, like),
        ilike(schema.students.srNo, like),
        ilike(schema.students.admissionNo, like),
        ilike(schema.students.phone, like),
        ilike(schema.students.fatherName, like),
        // The office is rung by mothers too, and asks after a child by the
        // village as often as by the surname. The last four Aadhaar digits are
        // what a parent reads off the card over the phone.
        ilike(schema.students.altPhone, like),
        ilike(schema.students.motherName, like),
        ilike(schema.students.village, like),
        ilike(schema.students.aadhaarLast4, like),
      )!,
    );
  }

  const dimensions: [string[] | undefined, AnyPgColumn][] = [
    [query.classes, schema.students.classLabel],
    [query.sections, schema.students.section],
    [query.houses, schema.students.house],
    [query.routes, schema.students.busRoute],
    [query.genders, schema.students.gender],
    [query.categories, schema.students.category],
    [query.villages, schema.students.village],
  ];
  for (const [values, column] of dimensions) {
    if (values && values.length > 0) clauses.push(inArray(column, values));
  }

  // Active by default. Saying so out loud in the result line is the page's job;
  // silently listing children who have left is what this fixes.
  const statuses = query.statuses?.length ? query.statuses : ["active"];
  if (!statuses.includes("*")) {
    clauses.push(inArray(schema.students.status, statuses));
  }

  // Each hole knows its own predicate now — see MISSING_COLUMNS.
  for (const field of query.missing ?? []) {
    const spec = MISSING_COLUMNS[field];
    if (spec) clauses.push(spec.where());
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

/**
 * Every value each dimension actually holds, with a count.
 *
 * The counts are the point: a chip that says "Rana Pratap 38" stops the office
 * picking a filter that covers a third of the class when they meant all of it,
 * and it does so before the empty table has to.
 *
 * SOURCED FROM THE DATABASE, NOT FROM A CONSTANT. Gender, category and section
 * have no canonical list anywhere that agrees with itself — the importer's
 * category list (GEN/OBC/SC/ST/EWS) and the field registry's
 * (GENERAL/OBC/SC/SBC/ST) are different sets, and a filter built on the wrong
 * one silently returns nothing at all. What is in the column is the truth.
 *
 * Deliberately NOT narrowed by the current filters. A facet list that shrinks
 * as you use it means the chip you want disappears the moment you pick another
 * one, and there is no way back except clearing everything.
 */
export type Facets = {
  classes: Map<string, number>;
  sections: Map<string, number>;
  houses: Map<string, number>;
  routes: Map<string, number>;
  genders: Map<string, number>;
  categories: Map<string, number>;
  villages: Map<string, number>;
  statuses: Map<string, number>;
  /** How many active students are missing each collectable field. */
  missing: Map<MissingField, number>;
};

export async function listFacets(): Promise<Facets> {
  const [
    classes,
    sections,
    houses,
    routes,
    genders,
    categories,
    villages,
    statuses,
    missing,
  ] = await Promise.all([
    facet(schema.students.classLabel),
    facet(schema.students.section),
    facet(schema.students.house),
    facet(schema.students.busRoute),
    facet(schema.students.gender),
    facet(schema.students.category),
    facet(schema.students.village),
    // Status is the one dimension counted across EVERY row: it is the filter
    // that decides which rows the others see, so counting it inside its own
    // default would always report zero for 'left'.
    facet(schema.students.status, false),
    missingCounts(),
  ]);

  return {
    classes,
    sections,
    houses,
    routes,
    genders,
    categories,
    villages,
    statuses,
    missing,
  };
}

async function facet(
  column: AnyPgColumn,
  activeOnly = true,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ value: column, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(activeOnly ? eq(schema.students.status, "active") : undefined)
    .groupBy(column);

  return new Map(
    rows
      .filter((row) => row.value !== null && String(row.value).trim() !== "")
      .map((row) => [String(row.value), row.n]),
  );
}

/** One query, one count per hole. Seven round trips here would be six too many. */
async function missingCounts(): Promise<Map<MissingField, number>> {
  const fields = Object.keys(MISSING_COLUMNS) as MissingField[];
  const [row] = await db
    .select(
      Object.fromEntries(
        fields.map((field) => [
          field,
          sql<number>`count(*) filter (where ${MISSING_COLUMNS[field].where()})::int`,
        ]),
      ) as Record<MissingField, SQL<number>>,
    )
    .from(schema.students)
    .where(eq(schema.students.status, "active"));

  return new Map(fields.map((field) => [field, Number(row?.[field] ?? 0)]));
}

/** Distinct class labels, ordered the way a timetable reads (6 before 10). */
export async function listClassLabels(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ classLabel: schema.students.classLabel })
    .from(schema.students);
  return rows.map((row) => row.classLabel).sort(compareClassLabels);
}

/**
 * Who a request is being sent about.
 *
 * OR within a dimension, AND across them: `{classes: [6,7,8], houses: ['Rana
 * Pratap']}` means those three classes AND that house, not their union. That is
 * the reading the office means by "classes 6 to 8, Rana Pratap house", and the
 * union reading would quietly send the whole school.
 *
 * `allActive` is the deliberate way to say "everyone". An audience with no
 * dimension set and no `allActive` selects NOBODY — see listAudienceRoster. A
 * missing filter must never widen the blast radius.
 */
export type Audience = {
  classes?: string[];
  houses?: string[];
  routes?: string[];
  allActive?: boolean;
  /**
   * THE REST OF THE BOARD'S DIMENSIONS, and they are here because leaving them
   * out was a hole rather than a simplification.
   *
   * The office can now turn a filtered board into a send, and the board filters
   * on more than three things. "Class 8, category SC, no photo" on screen,
   * pressed Send, used to become "Class 8, no photo" — a BIGGER set of children
   * than the one she was looking at, with nothing on any screen to say so. A
   * send that quietly covers more children than the office chose is the same
   * failure planFanOut's header spends thirty lines on, pointing the other way.
   */
  sections?: string[];
  genders?: string[];
  categories?: string[];
  villages?: string[];
  search?: string;
  /**
   * Narrow to the children with these holes, driven by the SAME predicates the
   * board filters on — so "no photo" here and "no photo" on /students cannot
   * drift into meaning two different things.
   *
   * This is what turns a filtered view into a send. Before it, the office could
   * see the forty-seven children with no photograph and then had to ask
   * nineteen teachers about five hundred.
   */
  gaps?: MissingField[];
  /**
   * An explicit list of children, and WHEN IT IS SET IT IS THE WHOLE AUDIENCE
   * — every dimension above is ignored. See audienceWhere for why.
   *
   * Two things produce one: an uploaded list, and createBatch freezing what it
   * resolved. `from` keeps what was ticked in the second case.
   */
  studentIds?: string[];
  /**
   * What she actually ticked, when `studentIds` was frozen from it.
   *
   * NEVER READ WHEN RESOLVING. It exists so the round's page can still say "no
   * photo, Classes 6 to 8" rather than "504 children", and so a later reader
   * can tell a frozen gap round from an uploaded list.
   */
  from?: Omit<Audience, "studentIds" | "from">;
  /**
   * A line about ONE child, by student id, from an uploaded list.
   *
   * EXPLAINS, NEVER RESOLVES — a note for a child the audience does not cover
   * is ignored, not an extra recipient. It lives here rather than only on
   * BatchInput so that a Resume days later still has the notes for the groups
   * it has yet to create; they are written onto request_students as each link
   * is frozen.
   */
  notes?: Record<string, string>;
};

function isEmptyAudience(audience: Audience): boolean {
  if (audience.allActive) return false;
  // An explicit list is an audience even when it names one child.
  if (audience.studentIds?.length) return false;
  // A gap NARROWS, so a gaps-only audience is a strict subset of allActive and
  // cannot widen the blast radius — which is the rule this function is for.
  if (audience.gaps?.length) return false;
  return (
    !audience.classes?.length &&
    !audience.houses?.length &&
    !audience.routes?.length &&
    !audience.sections?.length &&
    !audience.genders?.length &&
    !audience.categories?.length &&
    !audience.villages?.length &&
    !audience.search?.trim()
  );
}

function audienceWhere(audience: Audience): SQL {
  /*
   * A FROZEN LIST IS THE WHOLE AUDIENCE, and nothing else narrows it.
   *
   * ANDing the ids back together with the gaps they came from is the
   * nondeterminism freezing exists to remove: six photographs arrive
   * overnight, Resume re-resolves, and the links it creates cover a smaller
   * set than the ones it is finishing — while a class whose last photo-less
   * child was photographed gets no link at all and the board still says
   * nineteen groups.
   *
   * `status = 'active'` still applies. A child who has left the school is not
   * somebody to ask a teacher about, whatever a stale list says.
   */
  if (audience.studentIds?.length) {
    return and(
      eq(schema.students.status, "active"),
      inArray(schema.students.id, audience.studentIds),
    )!;
  }

  /*
   * ONE PREDICATE BUILDER, NOT TWO.
   *
   * The board's filters and a send's audience are the same question asked by
   * two screens, and the day they were two functions is the day the board could
   * show one set of children and the send cover another. This module already
   * carries that scar once — see the note at the top of lib/student-filters.ts
   * about the export and the board disagreeing.
   *
   * `statuses` is forced rather than passed through: the board may legitimately
   * be filtered to children who have left, and a send never may.
   */
  const where = buildWhere({
    search: audience.search,
    classes: audience.classes,
    sections: audience.sections,
    houses: audience.houses,
    routes: audience.routes,
    genders: audience.genders,
    categories: audience.categories,
    villages: audience.villages,
    statuses: ["active"],
    missing: audience.gaps,
  });

  return where ?? eq(schema.students.status, "active");
}

/**
 * The most a single explicit list may name. Mirrors MAX_STUDENTS in
 * lib/batches.ts, which otherwise only catches it after the roster is read.
 */
export const MAX_EXPLICIT_IDS = 3000;

/**
 * An audience that came from a browser, made safe to resolve.
 *
 * Every other field here has always been a plain string array, where an unknown
 * value simply matches nothing. `gaps` is different: it indexes a registry, and
 * a key that is not in it would put `undefined` into the clause list. Same
 * reasoning as normaliseFieldKeys in lib/requests.ts.
 */
export function normaliseAudience(input: Audience): Audience {
  const ids = input.studentIds?.length
    ? [...new Set(input.studentIds.map((id) => id.trim()).filter(Boolean))].slice(
        0,
        MAX_EXPLICIT_IDS,
      )
    : undefined;

  return {
    ...input,
    gaps: input.gaps?.filter((gap) => gap in MISSING_COLUMNS),
    studentIds: ids?.length ? ids : undefined,
    search: input.search?.trim() || undefined,
  };
}

/**
 * Roster for an audience, in name order. Used to freeze a request snapshot.
 *
 * Postgres collation and JS localeCompare do not agree on every string, and the
 * order the teacher sees comes from the snapshot read back later — so sort in JS
 * here too, with the same comparator, and the two can never disagree.
 */
export async function listAudienceRoster(
  audience: Audience,
): Promise<Student[]> {
  if (isEmptyAudience(audience)) return [];

  const roster = await db
    .select()
    .from(schema.students)
    .where(audienceWhere(audience));

  return roster.sort((a, b) => compareStudentNames(a.name, b.name));
}

/** How many active students an audience covers, without loading them. */
export async function countAudience(audience: Audience): Promise<number> {
  if (isEmptyAudience(audience)) return 0;

  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(audienceWhere(audience));

  return row?.total ?? 0;
}

/** Roster for one class. The single-class front door onto the same query. */
export async function listClassRoster(classLabel: string): Promise<Student[]> {
  return listAudienceRoster({ classes: [classLabel] });
}

/**
 * How many active students each house has, and each bus route.
 *
 * Both are sparse — house is recorded for about a third of the school and route
 * for about half — so the counts are shown next to the chips. Picking a house
 * that covers 38 children when you meant the whole class is a mistake the
 * number prevents before the preview has to.
 */
export async function countByHouse(): Promise<Map<string, number>> {
  return countByColumn(schema.students.house);
}

export async function countByRoute(): Promise<Map<string, number>> {
  return countByColumn(schema.students.busRoute);
}

async function countByColumn(
  column: typeof schema.students.house | typeof schema.students.busRoute,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ value: column, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(and(eq(schema.students.status, "active"), isNotNull(column)))
    .groupBy(column);

  return new Map(
    rows.filter((row) => row.value).map((row) => [row.value!, row.n]),
  );
}

/** How many active students each class actually has. Feeds the request builder. */
export async function countByClass(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      classLabel: schema.students.classLabel,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.students)
    .where(eq(schema.students.status, "active"))
    .groupBy(schema.students.classLabel);

  return new Map(rows.map((row) => [row.classLabel, row.n]));
}

/**
 * The other children on this child's numbers.
 *
 * A phone number in this school is a household's, not a child's, so two rows
 * sharing one are usually siblings — and the sibling's record is the fastest
 * way to fill a hole in this one (same father, same village, same route). The
 * review queue already says "also on N other students"; this is the same fact
 * on the page a parent's call opens.
 *
 * EVERY STATUS, on purpose: a brother who left last year is still context for
 * the sister who is here.
 */
export async function listSharingPhone(
  studentId: string,
): Promise<
  Pick<Student, "id" | "name" | "classLabel" | "rollNo" | "phone" | "altPhone" | "status" | "photoPath">[]
> {
  /*
   * BY ID, WITH THE CHILD'S OWN NUMBERS LOOKED UP IN SQL, so this can run
   * alongside the read of the student row instead of after it. Taking the row
   * as an argument cost the page a second round trip to Singapore for one
   * query — the whole of its second wave.
   *
   * An empty string is not a shared number: imports have produced both null
   * and '', and matching on '' would put every child with no number on every
   * other such child's page as a "sibling".
   */
  const rows = await db
    .select({
      id: schema.students.id,
      name: schema.students.name,
      classLabel: schema.students.classLabel,
      rollNo: schema.students.rollNo,
      phone: schema.students.phone,
      altPhone: schema.students.altPhone,
      status: schema.students.status,
      photoPath: schema.students.photoPath,
    })
    .from(schema.students)
    .where(
      and(
        ne(schema.students.id, studentId),
        sql`exists (
          select 1 from ${schema.students} as me
          where me.id = ${studentId}
            and (
              (nullif(btrim(me.phone), '') is not null
                and (${schema.students.phone} = me.phone or ${schema.students.altPhone} = me.phone))
              or (nullif(btrim(me.alt_phone), '') is not null
                and (${schema.students.phone} = me.alt_phone or ${schema.students.altPhone} = me.alt_phone))
            )
        )`,
      ),
    );

  return rows.sort(
    (a, b) =>
      compareClassLabels(a.classLabel, b.classLabel) || compareStudentNames(a.name, b.name),
  );
}
