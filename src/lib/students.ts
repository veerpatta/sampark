import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "./db";
import { compareClassLabels } from "./classes";
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
      .orderBy(asc(schema.students.classLabel), asc(schema.students.rollNo), asc(schema.students.name))
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

/** Roster for one class, in roll-number order. Used to freeze a request snapshot. */
export async function listClassRoster(classLabel: string): Promise<Student[]> {
  return db
    .select()
    .from(schema.students)
    .where(
      and(
        eq(schema.students.classLabel, classLabel),
        eq(schema.students.status, "active"),
      ),
    )
    .orderBy(asc(schema.students.rollNo), asc(schema.students.name));
}
