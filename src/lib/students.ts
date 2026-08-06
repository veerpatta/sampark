import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db, schema } from "./db";
import { compareClassLabels, compareStudentNames } from "./classes";
import type { Student } from "../../drizzle/schema";

/** Server-side reads over the master record. Never imported by a client component. */

export type StudentQuery = {
  search?: string;
  classLabel?: string;
  limit?: number;
  offset?: number;
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
      // Name, not roll number: the export has no roll numbers and every row
      // carries null, which made this list arbitrary. See compareStudentNames.
      .orderBy(asc(schema.students.classLabel), asc(schema.students.name))
      .limit(limit)
      .offset(query.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.students)
      .where(where),
  ]);

  return { students, total: count?.total ?? 0 };
}

function buildWhere(query: StudentQuery): SQL | undefined {
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
        ilike(schema.students.phone, like),
        ilike(schema.students.fatherName, like),
      )!,
    );
  }

  if (query.classLabel) {
    clauses.push(eq(schema.students.classLabel, query.classLabel));
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
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
