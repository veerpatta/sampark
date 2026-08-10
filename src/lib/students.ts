import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
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
  | "father";

export type StudentSort = "name" | "class" | "recent" | "complete";

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

const MISSING_COLUMNS: Record<MissingField, AnyPgColumn> = {
  phone: schema.students.phone,
  photo: schema.students.photoPath,
  aadhaar: schema.students.aadhaar,
  dob: schema.students.dob,
  house: schema.students.house,
  route: schema.students.busRoute,
  father: schema.students.fatherName,
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
    const filled = sql.join(
      COMPLETENESS_COLUMNS.map(
        (column) =>
          sql`(case when nullif(btrim(${sql.identifier(column)}::text), '') is null then 0 else 1 end)`,
      ),
      sql` + `,
    );
    return [sql`(${filled}) asc`, asc(schema.students.name)] as unknown as SQL[];
  }
  return byName;
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

  // An empty string is a hole too. Imports have produced both, and a filter
  // that finds only the NULLs quietly under-reports the work left.
  for (const field of query.missing ?? []) {
    const column = MISSING_COLUMNS[field];
    if (column) clauses.push(sql`nullif(btrim(${column}::text), '') is null`);
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
          sql<number>`count(*) filter (where nullif(btrim(${MISSING_COLUMNS[field]}::text), '') is null)::int`,
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
};

function isEmptyAudience(audience: Audience): boolean {
  if (audience.allActive) return false;
  return (
    !audience.classes?.length &&
    !audience.houses?.length &&
    !audience.routes?.length
  );
}

function audienceWhere(audience: Audience): SQL {
  const clauses: SQL[] = [eq(schema.students.status, "active")];

  if (audience.classes?.length) {
    clauses.push(inArray(schema.students.classLabel, audience.classes));
  }
  if (audience.houses?.length) {
    clauses.push(inArray(schema.students.house, audience.houses));
  }
  if (audience.routes?.length) {
    clauses.push(inArray(schema.students.busRoute, audience.routes));
  }

  return clauses.length === 1 ? clauses[0]! : and(...clauses)!;
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
