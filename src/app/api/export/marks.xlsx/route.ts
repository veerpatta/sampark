import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook, type ExportColumn } from "@/lib/excel";
import {
  askedFor,
  collectedMarks,
  groupMarks,
  summariseMarks,
  UNATTRIBUTED,
  type MarkRow,
  type SheetRow,
  type SummaryRow,
} from "@/lib/marks";
import { countByClass } from "@/lib/students";

/**
 * Every mark entered for one period, in one file, split by whoever entered it.
 *
 * Marks do not pass through /review any more — they are written the moment a
 * teacher submits (see lib/submissions.ts) — so this and the /marks board are
 * how a round gets looked at. The summary sheet leads for that reason: the
 * first question after a marks round is not "what are the numbers" but "who
 * has not sent theirs".
 *
 * NOT the FA_Marks_Pattern.xlsx export. That one has to reproduce LEAD's own
 * layout exactly and is still blocked on being given the file — see the note at
 * the foot of lib/excel.ts. This is the office's internal workbook and owes
 * nothing to that shape.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A row on any per-teacher or per-class sheet, flattened for the writer. */
type Flat = Record<string, string | number | null>;

/**
 * The summary sheet, as a projection and as columns.
 *
 * Declared once and used twice: to flatten a SummaryRow into a header-keyed bag
 * and to describe the columns that read it back. Two lists would be two places
 * for a header string to drift, and a header that drifts is a silently empty
 * column.
 */
const SUMMARY_FIELDS: {
  header: string;
  width: number;
  value: (row: SummaryRow) => string | number | null;
}[] = [
  { header: "Teacher", width: 22, value: (row) => row.teacher },
  { header: "Subject", width: 20, value: (row) => row.subject },
  { header: "Class", width: 10, value: (row) => row.classLabel },
  { header: "Entered", width: 10, value: (row) => row.entered },
  { header: "On roster", width: 11, value: (row) => row.onRoster },
  { header: "Missing", width: 10, value: (row) => row.missing },
  {
    header: "Last entered",
    width: 14,
    value: (row) => row.lastEntered?.toISOString().slice(0, 10) ?? null,
  },
];

const SUMMARY_COLUMNS: ExportColumn<Flat>[] = SUMMARY_FIELDS.map((field) => ({
  header: field.header,
  width: field.width,
  value: (row) => row[field.header] ?? null,
}));

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new Response("Not signed in", { status: 401 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period")?.trim();
  if (!period) {
    return new Response(
      "Which period? Add ?period=2026-27/FA1, or use the button on the Marks page.",
      { status: 400 },
    );
  }

  // Anything other than the by-class switch is the by-teacher file, which is
  // what the office asked for and what a stray query string should still give.
  const by = url.searchParams.get("by") === "class" ? "class" : "teacher";

  const [marks, rosterSizes, asked] = await Promise.all([
    collectedMarks(period),
    countByClass(),
    askedFor(period),
  ]);

  if (marks.length === 0 && asked.length === 0) {
    return new Response(`Nothing has been asked or entered for ${period}.`, {
      status: 404,
    });
  }

  // `asked` carries the teachers who have sent nothing, so the summary sheet
  // shows them on a 0 / 24 line rather than leaving them off the file — which
  // is the difference between a report and a list of whoever happened to reply.
  const summary = summariseMarks(marks, rosterSizes, asked);
  const sheets = groupMarks(marks, by);
  const labels = sheetLabels(sheets, marks, by);

  const file = await buildWorkbook<Flat>(
    [
      {
        name: "Summary",
        rows: summary.map((row) =>
          Object.fromEntries(
            SUMMARY_FIELDS.map((field) => [field.header, field.value(row)]),
          ),
        ),
        columns: SUMMARY_COLUMNS,
      },
      ...sheets.map((sheet, index) => ({
        name: labels[index]!,
        rows: sheet.rows.map((row) => flatten(row, sheet.subjects, by)),
        columns: columnsFor(sheet.subjects, by),
      })),
    ],
    SUMMARY_COLUMNS,
  );

  // A period reads '2026-27/FA1' and that slash must never reach a filename.
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `sampark-marks-${period}-by-${by}-${stamp}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return new Response(new Uint8Array(file), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * SR no leads, for the same reason the per-request export gives: it is what the
 * fee app joins on when a file goes back. Everything is written as text by the
 * writer, so a mark cannot come back as a date.
 */
function columnsFor(
  subjects: { key: string; label: string }[],
  by: "teacher" | "class",
): ExportColumn<Flat>[] {
  const cell =
    (header: string) =>
    (row: Flat) =>
      row[header] ?? null;

  return [
    { header: "SR no", width: 12, value: cell("SR no") },
    { header: "Student ID", width: 14, value: cell("Student ID") },
    { header: "Name", width: 26, value: cell("Name") },
    { header: "Class", width: 10, value: cell("Class") },
    { header: "Roll", width: 8, value: cell("Roll") },
    // A class sheet spans teachers, so it has to say who entered the row. A
    // teacher sheet is already the answer to that question.
    ...(by === "class"
      ? [{ header: "Teacher", width: 22, value: cell("Teacher") }]
      : []),
    ...subjects.map((subject) => ({
      header: subject.label,
      width: 12,
      value: cell(subject.label),
    })),
    { header: "First entered", width: 14, value: cell("First entered") },
  ];
}

function flatten(
  row: SheetRow,
  subjects: { key: string; label: string }[],
  by: "teacher" | "class",
): Flat {
  const flat: Flat = {
    "SR no": row.srNo,
    "Student ID": row.studentId,
    Name: row.name,
    Class: row.classLabel,
    Roll: row.rollNo,
    "First entered": row.firstEnteredAt?.toISOString().slice(0, 10) ?? null,
  };
  if (by === "class") flat.Teacher = row.teacher;
  for (const subject of subjects) {
    flat[subject.label] = row.marks[subject.key] ?? null;
  }
  return flat;
}

/**
 * Tab labels, disambiguating PEOPLE rather than strings.
 *
 * buildWorkbook already guarantees two sheets never end up with one name — but
 * all it can do is add a counter, which leaves the office looking at "Sunita
 * Sharma" and "Sunita Sharma~2" with no way to tell which is which. Two
 * teachers really can share a name: teachers.id is the key, the name is not
 * unique and was never promised to be. Only this route knows they are different
 * people, so this is where the distinguishing mark goes on.
 */
function sheetLabels(
  sheets: { name: string }[],
  marks: MarkRow[],
  by: "teacher" | "class",
): string[] {
  if (by === "class") return sheets.map((sheet) => sheet.name);

  const idsByName = new Map<string, Set<string>>();
  for (const mark of marks) {
    if (!mark.teacherId) continue;
    const name = mark.teacherName ?? UNATTRIBUTED;
    const ids = idsByName.get(name) ?? new Set<string>();
    ids.add(mark.teacherId);
    idsByName.set(name, ids);
  }

  return sheets.map((sheet) => {
    const ids = idsByName.get(sheet.name);
    if (!ids || ids.size < 2) return sheet.name;
    // Two people, one name. The id tail is what the office can look up.
    const id = [...ids].sort().find((candidate) =>
      marks.some(
        (mark) => mark.teacherId === candidate && mark.teacherName === sheet.name,
      ),
    );
    return id ? `${sheet.name} (${id.slice(-4)})` : sheet.name;
  });
}
