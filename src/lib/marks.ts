import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { compareClassLabels, compareStudentNames } from "./classes";
import { classesByRequest } from "./requests";
import { FA_MARKS_KIND } from "./subjects";

/**
 * Reading marks back out: the board the office watches a round on, and the
 * workbook it takes away at the end.
 *
 * Marks no longer pass through /review — they are written at submit time (see
 * lib/submissions.ts) — so this module is the office's only view of a round.
 * That raises the bar on it: "who has not entered yet" has to be answerable
 * here, because nothing else asks the question any more.
 *
 * THE SHAPING FUNCTIONS AT THE BOTTOM ARE PURE. Every bug this file can have
 * that matters is a shaping bug — a teacher's marks landing on the wrong sheet,
 * a subject column in the wrong place, an unattributed row silently dropped —
 * and those get to be tested without a database.
 */

/** One stored mark, with everything the board and the workbook need about it. */
export type MarkRow = {
  studentId: string;
  srNo: string | null;
  name: string;
  classLabel: string;
  rollNo: number | null;
  fieldKey: string;
  fieldLabel: string;
  /** field_defs.sort_order, which the seed generates from SUBJECTS. */
  sortOrder: number;
  value: string | null;
  /**
   * When the mark was FIRST stored. The upsert in recordSubmissions rewrites
   * `value` and `request_id` and deliberately leaves this alone, so a corrected
   * mark still reads as the moment that child's mark first arrived. Labelled
   * "first entered" everywhere it is shown, because that is what it is.
   */
  firstEnteredAt: Date;
  /** Null when the request behind the mark is gone. See collectedMarks. */
  teacherId: string | null;
  teacherName: string | null;
  requestId: string | null;
};

/** The sheet name a row with no teacher lands under, on screen and in the file. */
export const UNATTRIBUTED = "Unattributed";

/**
 * Every period worth looking at, newest first.
 *
 * ASKED PERIODS AS WELL AS ANSWERED ONES. A round sent this morning that nobody
 * has replied to yet has no student_records at all, so reading only that table
 * leaves it off the picker entirely — and the one period the office most wants
 * to check on would be the one it could not select. It appears with a count of
 * zero instead, which is both true and the useful answer.
 *
 * Ad-hoc answers are filed under `ask/<id>` (see resolvePeriod) and are not
 * marks; the record_kind filter excludes them without having to know that.
 */
export async function listMarksPeriods(): Promise<
  { period: string; marks: number; lastEntered: Date | null }[]
> {
  const [answered, asked] = await Promise.all([
    db
      .select({
        period: schema.studentRecords.period,
        marks: sql<number>`count(*)::int`,
        lastEntered: sql<Date>`max(${schema.studentRecords.createdAt})`,
      })
      .from(schema.studentRecords)
      .innerJoin(
        schema.fieldDefs,
        eq(schema.fieldDefs.key, schema.studentRecords.fieldKey),
      )
      .where(eq(schema.fieldDefs.recordKind, FA_MARKS_KIND))
      .groupBy(schema.studentRecords.period),
    db
      .selectDistinct({ period: schema.requests.period })
      .from(schema.requests)
      .where(
        and(
          isNull(schema.requests.archivedAt),
          sql`${schema.requests.period} is not null`,
          sql`${schema.requests.period} not like 'ask/%'`,
        ),
      ),
  ]);

  type Row = { period: string; marks: number; lastEntered: Date | null };
  const periods = new Map<string, Row>();

  for (const row of asked) {
    if (!row.period) continue;
    periods.set(row.period, { period: row.period, marks: 0, lastEntered: null });
  }
  for (const row of answered) {
    periods.set(row.period, {
      period: row.period,
      marks: row.marks,
      lastEntered: row.lastEntered ? new Date(row.lastEntered) : null,
    });
  }

  // Newest first. A period nobody has answered has no entry time, so it falls
  // back to its label — which for '2026-27/FA1' is the order anyone expects.
  return [...periods.values()].sort((a, b) => {
    if (a.lastEntered && b.lastEntered) {
      return b.lastEntered.getTime() - a.lastEntered.getTime();
    }
    if (a.lastEntered) return -1;
    if (b.lastEntered) return 1;
    return b.period.localeCompare(a.period);
  });
}

/**
 * Every mark stored for one period.
 *
 * BOTH JOINS TO THE REQUEST SIDE ARE LEFT JOINS, and that is not defensive
 * habit. `student_records.request_id` is a bare uuid with no foreign key
 * (drizzle/schema.ts), so a dangling id is representable — and an inner join
 * would answer "which marks do we hold" by silently leaving some out. A report
 * that quietly does not total is worse than one with an awkward extra sheet on
 * the end, so anything without a teacher goes to `Unattributed` and is counted
 * there.
 */
export async function collectedMarks(period: string, classLabel?: string): Promise<MarkRow[]> {
  const rows = await db
    .select({
      studentId: schema.students.id,
      srNo: schema.students.srNo,
      name: schema.students.name,
      classLabel: schema.students.classLabel,
      rollNo: schema.students.rollNo,
      fieldKey: schema.studentRecords.fieldKey,
      fieldLabel: schema.fieldDefs.labelEn,
      sortOrder: schema.fieldDefs.sortOrder,
      value: schema.studentRecords.value,
      firstEnteredAt: schema.studentRecords.createdAt,
      requestId: schema.studentRecords.requestId,
      teacherId: schema.teachers.id,
      teacherName: schema.teachers.name,
    })
    .from(schema.studentRecords)
    .innerJoin(
      schema.students,
      eq(schema.students.id, schema.studentRecords.studentId),
    )
    .innerJoin(
      schema.fieldDefs,
      eq(schema.fieldDefs.key, schema.studentRecords.fieldKey),
    )
    .leftJoin(
      schema.requests,
      eq(schema.requests.id, schema.studentRecords.requestId),
    )
    .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(
      and(
        eq(schema.studentRecords.period, period),
        eq(schema.fieldDefs.recordKind, FA_MARKS_KIND),
        classLabel ? eq(schema.students.classLabel, classLabel) : undefined,
      ),
    );

  return rows.map((row) => ({
    ...row,
    sortOrder: row.sortOrder ?? 100,
    teacherId: row.teacherId ?? null,
    teacherName: row.teacherName ?? null,
  }));
}

/* ========================================================================== */
/*                          SHAPING — PURE FROM HERE                          */
/* ========================================================================== */

/** One line of the board: what one teacher entered for one subject, one class. */
export type SummaryRow = {
  teacher: string;
  subject: string;
  classLabel: string;
  entered: number;
  onRoster: number;
  missing: number;
  lastEntered: Date | null;
};

/** What was ASKED of one teacher: one request, one subject, one group. */
export type AskedFor = {
  /** Carried so a board line can link back to the link that asked for it. */
  requestId: string;
  teacherId: string;
  teacher: string;
  subject: string;
  classLabel: string;
  fieldKey: string;
};

/**
 * The board, and the workbook's first sheet.
 *
 * BUILT FROM WHAT WAS ASKED, NOT FROM WHAT ARRIVED, and that distinction is the
 * whole reason this screen exists. Summarising the stored marks alone answers
 * "who has entered what" — but the question the office actually has after a
 * marks round is "who has NOT sent theirs", and a teacher who has entered
 * nothing has no rows to summarise. She would simply be absent from the board,
 * which reads exactly like a round nobody was asked to do.
 *
 * That was not hypothetical: the first version of this took only the records,
 * and a fixture school with one teacher finished and one who had not started
 * rendered as "1 subject across 1 teacher" with no hint the second existed.
 *
 * So `asked` leads and the marks are matched onto it. Anything that arrived
 * without a request behind it is still reported (see UNATTRIBUTED) rather than
 * dropped — a file that quietly does not total is worse than an awkward row.
 *
 * `onRoster` is the size of the whole class, not of the request's frozen
 * roster: a child admitted after the link went out is missing a mark just the
 * same, and a denominator that shrank to match what was sent would report a
 * complete round that is not complete.
 */
export function summariseMarks(
  rows: MarkRow[],
  rosterSizes: Map<string, number>,
  asked: AskedFor[] = [],
): SummaryRow[] {
  const key = (teacher: string, fieldKey: string, classLabel: string) =>
    `${teacher}|${fieldKey}|${classLabel}`;

  // Every line that should appear, whether or not a mark has arrived for it.
  const lines = new Map<string, SummaryRow>();
  for (const ask of asked) {
    lines.set(key(ask.teacher, ask.fieldKey, ask.classLabel), {
      teacher: ask.teacher,
      subject: ask.subject,
      classLabel: ask.classLabel,
      entered: 0,
      onRoster: rosterSizes.get(ask.classLabel) ?? 0,
      missing: rosterSizes.get(ask.classLabel) ?? 0,
      lastEntered: null,
    });
  }

  const groups = new Map<string, MarkRow[]>();
  for (const row of rows) {
    const id = key(row.teacherName ?? UNATTRIBUTED, row.fieldKey, row.classLabel);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }

  for (const [id, group] of groups) {
    const first = group[0]!;
    // Distinct children, so a duplicated row cannot report more marks than
    // there are students and push a class past 100%.
    const entered = new Set(group.map((row) => row.studentId)).size;
    const onRoster =
      lines.get(id)?.onRoster ?? rosterSizes.get(first.classLabel) ?? 0;

    lines.set(id, {
      teacher: first.teacherName ?? UNATTRIBUTED,
      subject: first.fieldLabel,
      classLabel: first.classLabel,
      entered,
      onRoster,
      missing: Math.max(0, onRoster - entered),
      lastEntered: group.reduce<Date | null>(
        (latest, row) =>
          !latest || row.firstEnteredAt > latest ? row.firstEnteredAt : latest,
        null,
      ),
    });
  }

  return [...lines.values()].sort(
    (a, b) =>
      a.teacher.localeCompare(b.teacher) ||
      compareClassLabels(a.classLabel, b.classLabel) ||
      a.subject.localeCompare(b.subject),
  );
}

/**
 * Who was asked for marks in this period.
 *
 * One row per (request, field): a request is one teacher and one group, and may
 * carry several subjects. Archived requests are excluded — the office has
 * stopped watching those, and a board is a list of what is still live.
 */
/**
 * Every field key that IS a mark, read off the registry.
 *
 * Read from `record_kind` and never from SUBJECTS, so a seventeenth subject
 * added as a field_defs row is a mark with no deploy — rule 11. Extracted from
 * askedFor because lib/progress.ts needs the same set to tell a marks link from
 * a details link, and two readers of "what counts as a mark" is exactly how the
 * definition of "answered" ended up wrong in three places.
 */
export async function marksFieldKeys(): Promise<Map<string, string>> {
  const fields = await db
    .select({
      key: schema.fieldDefs.key,
      labelEn: schema.fieldDefs.labelEn,
      recordKind: schema.fieldDefs.recordKind,
    })
    .from(schema.fieldDefs);

  return new Map(
    fields
      .filter((field) => field.recordKind === FA_MARKS_KIND)
      .map((field) => [field.key, field.labelEn]),
  );
}

/** Label and ceiling per marks field, for a grid's column headings. */
export async function marksFieldDefs(): Promise<
  Map<string, { label: string; outOf: number | null; sortOrder: number }>
> {
  const fields = await db
    .select({
      key: schema.fieldDefs.key,
      labelEn: schema.fieldDefs.labelEn,
      recordKind: schema.fieldDefs.recordKind,
      maxValue: schema.fieldDefs.maxValue,
      sortOrder: schema.fieldDefs.sortOrder,
    })
    .from(schema.fieldDefs);

  return new Map(
    fields
      .filter((field) => field.recordKind === FA_MARKS_KIND)
      .map((field) => [
        field.key,
        {
          label: field.labelEn,
          outOf: field.maxValue === null || Number.isNaN(Number(field.maxValue)) ? null : Number(field.maxValue),
          sortOrder: field.sortOrder ?? 100,
        },
      ]),
  );
}

export async function askedFor(period: string): Promise<AskedFor[]> {
  const rows = await db
    .select({
      requestId: schema.requests.id,
      teacherId: schema.teachers.id,
      teacher: schema.teachers.name,
      fieldKeys: schema.requests.fieldKeys,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(
      and(eq(schema.requests.period, period), isNull(schema.requests.archivedAt)),
    );

  if (rows.length === 0) return [];

  const [marksFields, classesById] = await Promise.all([
    marksFieldKeys(),
    /*
     * THE CLASSES THE FROZEN ROSTER ACTUALLY COVERS, not the audience label.
     *
     * This used to take `requests.audience_label` as the class. For a class
     * round that string IS the class and everything lined up. For a SUBJECT
     * round it is "Economics — Prakash Bunkar" (see lib/fanout.ts), and one
     * subject link legitimately spans four classes because the fan-out merges
     * them per teacher — so there was no single class label to take.
     *
     * The damage was not a wrong denominator, it was a PHANTOM ROW.
     * summariseMarks seeds a line per ask keyed on this label, then folds the
     * arriving marks on keyed by the child's real class. Those two keys never
     * met, so a subject round rendered an extra "Economics — Prakash Bunkar"
     * line at 0 / 0 beside the real per-class lines — and a subject teacher who
     * had entered NOTHING produced only the phantom, so the board said "not
     * started" with no denominator and could not say she owed eighty-four
     * children. It also inflated the "N subjects" and "not started" counts in
     * the heading.
     *
     * classesByRequest reads the frozen roster and is already used by the
     * request detail page and getBatch for exactly this reason.
     */
    classesByRequest(rows.map((row) => row.requestId)),
  ]);

  return rows.flatMap((row) =>
    row.fieldKeys
      .filter((fieldKey) => marksFields.has(fieldKey))
      .flatMap((fieldKey) =>
        (classesById.get(row.requestId) ?? []).map((classLabel) => ({
          requestId: row.requestId,
          teacherId: row.teacherId,
          teacher: row.teacher,
          subject: marksFields.get(fieldKey)!,
          classLabel,
          fieldKey,
        })),
      ),
  );
}

/** One student's line on a sheet: their marks across every subject on it. */
export type SheetRow = {
  studentId: string;
  srNo: string | null;
  name: string;
  classLabel: string;
  rollNo: number | null;
  teacher: string;
  /** Keyed by field key. Absent means this teacher entered nothing for them. */
  marks: Record<string, string | null>;
  firstEnteredAt: Date | null;
};

export type MarkSheet = {
  name: string;
  /** The subject columns this sheet needs, already in display order. */
  subjects: { key: string; label: string }[];
  rows: SheetRow[];
};

/**
 * Marks regrouped into the sheets of a workbook.
 *
 * `by: "teacher"` is the accountability shape — one sheet per teacher, which is
 * what the office asked for and what it forwards. `by: "class"` is the same
 * rows keyed the other way, which is the shape a report card wants. One
 * grouping key over one dataset, so both stay honest about the same numbers.
 *
 * Each sheet carries ONLY the subject columns that appear on it. A teacher who
 * takes one subject gets one column, not sixteen mostly-empty ones.
 */
export function groupMarks(
  rows: MarkRow[],
  by: "teacher" | "class" = "teacher",
): MarkSheet[] {
  const keyOf = (row: MarkRow) =>
    by === "teacher" ? (row.teacherName ?? UNATTRIBUTED) : row.classLabel;

  const groups = new Map<string, MarkRow[]>();
  for (const row of rows) {
    const group = groups.get(keyOf(row)) ?? [];
    group.push(row);
    groups.set(keyOf(row), group);
  }

  const sheets = [...groups.entries()].map(([name, group]) => {
    const subjects = [
      ...new Map(
        group
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => [row.fieldKey, { key: row.fieldKey, label: row.fieldLabel }]),
      ).values(),
    ];

    const students = new Map<string, SheetRow>();
    for (const row of group) {
      const existing = students.get(row.studentId) ?? {
        studentId: row.studentId,
        srNo: row.srNo,
        name: row.name,
        classLabel: row.classLabel,
        rollNo: row.rollNo,
        teacher: row.teacherName ?? UNATTRIBUTED,
        marks: {},
        firstEnteredAt: null,
      };
      existing.marks[row.fieldKey] = row.value;
      if (!existing.firstEnteredAt || row.firstEnteredAt < existing.firstEnteredAt) {
        existing.firstEnteredAt = row.firstEnteredAt;
      }
      students.set(row.studentId, existing);
    }

    return {
      name,
      subjects,
      rows: [...students.values()].sort(
        (a, b) =>
          compareClassLabels(a.classLabel, b.classLabel) ||
          compareStudentNames(a.name, b.name),
      ),
    };
  });

  // Unattributed last: it is an exception to chase, not the first thing to read.
  return sheets.sort((a, b) => {
    if (a.name === UNATTRIBUTED) return 1;
    if (b.name === UNATTRIBUTED) return -1;
    return by === "class"
      ? compareClassLabels(a.name, b.name)
      : a.name.localeCompare(b.name);
  });
}

/* ------------------------------------------------------- one child's marks */

/** What the student page needs about one stored mark. */
export type StudentMark = {
  fieldKey: string;
  fieldLabel: string;
  sortOrder: number | null;
  period: string;
  value: string | null;
  /** field_defs.max_value, as text — numeric comes back from Postgres as a string. */
  maxValue: string | null;
};

export type StudentMarksGrid = {
  /** Oldest first, so a row reads left to right through the year. */
  periods: string[];
  subjects: {
    key: string;
    label: string;
    outOf: number | null;
    /** One entry per period, aligned with `periods`. Null where nothing was entered. */
    values: (number | null)[];
  }[];
};

/**
 * One child's marks pivoted into subject rows and period columns.
 *
 * Pure. Subjects keep the registry's sort order — the order the seed generates
 * from SUBJECTS, which is the order a report card reads — and only subjects
 * that hold at least one mark appear, so a child who takes four subjects gets
 * four rows rather than sixteen mostly-empty ones.
 */
export function pivotStudentMarks(rows: StudentMark[]): StudentMarksGrid {
  const periods = [...new Set(rows.map((row) => row.period))].sort((a, b) => a.localeCompare(b));
  const subjects = new Map<string, StudentMarksGrid["subjects"][number] & { sortOrder: number }>();

  for (const row of rows) {
    const subject = subjects.get(row.fieldKey) ?? {
      key: row.fieldKey,
      label: row.fieldLabel,
      outOf: row.maxValue === null || row.maxValue === "" || Number.isNaN(Number(row.maxValue)) ? null : Number(row.maxValue),
      values: periods.map(() => null),
      sortOrder: row.sortOrder ?? 100,
    };
    const index = periods.indexOf(row.period);
    const numeric = row.value === null || row.value.trim() === "" ? NaN : Number(row.value);
    subject.values[index] = Number.isFinite(numeric) ? numeric : null;
    subjects.set(row.fieldKey, subject);
  }

  return {
    periods,
    subjects: [...subjects.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
      .map((subject) => ({
        key: subject.key,
        label: subject.label,
        outOf: subject.outOf,
        values: subject.values,
      })),
  };
}

/* ----------------------------------------------------------- class grid */

export type GridSubject = {
  key: string;
  label: string;
  outOf: number | null;
  entered: number;
  average: number | null;
};

export type GridRow = {
  studentId: string;
  name: string;
  rollNo: number | null;
  /** Keyed by field key. Null where nothing has been entered. */
  marks: Record<string, number | null>;
  blanks: number;
};

export type MarksGrid = { subjects: GridSubject[]; rows: GridRow[] };

/**
 * One class, one period: every child down the side, every subject asked for
 * across the top, and the blanks where a mark has not arrived.
 *
 * THE ROSTER LEADS, not the marks. A child with no marks at all is a full row
 * of blanks, which is the row the office is looking for. Subjects are the
 * union of what was ASKED for this class and what ARRIVED — a mark that came
 * in through a request since removed still shows, in a column of its own.
 *
 * Averages ignore blanks: an average over "the marks entered so far" is a
 * number a teacher can check against her register; one over the whole roll
 * is a number that falls every time a child is admitted.
 */
export function buildMarksGrid(
  roster: { id: string; name: string; rollNo: number | null }[],
  rows: MarkRow[],
  asked: { key: string; label: string; outOf: number | null; sortOrder: number }[],
): MarksGrid {
  const subjects = new Map<string, GridSubject & { sortOrder: number }>();
  for (const subject of asked) {
    subjects.set(subject.key, { ...subject, entered: 0, average: null });
  }
  for (const row of rows) {
    if (!subjects.has(row.fieldKey)) {
      subjects.set(row.fieldKey, {
        key: row.fieldKey,
        label: row.fieldLabel,
        outOf: null,
        sortOrder: row.sortOrder,
        entered: 0,
        average: null,
      });
    }
  }

  const byStudent = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    const marks = byStudent.get(row.studentId) ?? new Map();
    const numeric = row.value === null || row.value.trim() === "" ? NaN : Number(row.value);
    marks.set(row.fieldKey, Number.isFinite(numeric) ? numeric : null);
    byStudent.set(row.studentId, marks);
  }

  const ordered = [...subjects.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  const gridRows: GridRow[] = roster
    .slice()
    .sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || compareStudentNames(a.name, b.name))
    .map((student) => {
      const marks: Record<string, number | null> = {};
      let blanks = 0;
      for (const subject of ordered) {
        const value = byStudent.get(student.id)?.get(subject.key) ?? null;
        marks[subject.key] = value;
        if (value === null) blanks += 1;
      }
      return { studentId: student.id, name: student.name, rollNo: student.rollNo, marks, blanks };
    });

  const totals = new Map<string, { sum: number; n: number }>();
  for (const row of gridRows) {
    for (const subject of ordered) {
      const value = row.marks[subject.key];
      if (value === null || value === undefined) continue;
      const total = totals.get(subject.key) ?? { sum: 0, n: 0 };
      total.sum += value;
      total.n += 1;
      totals.set(subject.key, total);
    }
  }

  return {
    subjects: ordered.map((subject) => {
      const total = totals.get(subject.key);
      return {
        key: subject.key,
        label: subject.label,
        outOf: subject.outOf,
        entered: total?.n ?? 0,
        average: total && total.n > 0 ? Math.round((total.sum / total.n) * 10) / 10 : null,
      };
    }),
    rows: gridRows,
  };
}
