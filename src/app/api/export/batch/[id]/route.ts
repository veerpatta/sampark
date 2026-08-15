import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook, uniqueSheetName, type ExportColumn } from "@/lib/excel";
import { collectedForBatch, type CollectedGroup, type CollectedRow } from "@/lib/requests";
import { FA_MARKS_KIND } from "@/lib/subjects";

/**
 * Everything one send-to-many round collected, in one file.
 *
 * A round is one question asked of nineteen groups, and until now the only way
 * to get it out was nineteen separate downloads that then had to be stitched
 * together in Excel — which is the manual work this whole app exists to remove.
 * The summary sheet leads because the first question about a finished round is
 * not "what are the answers" but "which groups are still short".
 *
 * NOT keyed on period, deliberately, which is what makes this different from
 * /api/export/marks.xlsx. Two marks rounds can share a period, so a
 * period-keyed file cannot answer "this round" at all — and student_records
 * cannot attribute a mark to a round durably, because a correction rewrites its
 * request_id (see the upsert in lib/submissions.ts). The frozen roster and the
 * append-only submissions can, so this reads those.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A row on any sheet, flattened for the writer. */
type Flat = Record<string, string | number | null>;

/**
 * The summary sheet, as a projection and as columns.
 *
 * Declared once and used twice — to flatten a group into a keyed bag and to
 * describe the columns that read it back. Two lists would be two places for a
 * key to drift, and a key that drifts is a silently empty column.
 */
const SUMMARY_FIELDS: {
  header: string;
  width: number;
  value: (group: CollectedGroup, sheet: string) => string | number | null;
}[] = [
  /*
   * The worksheet this group is on, and it leads.
   *
   * Sheet names are capped at 31 characters, so two long subject labels can
   * truncate onto each other and come out as "…" and "…~2". Rather than invent
   * a naming convention to prevent that, the index is in the file: whatever the
   * tab ended up being called, this column says which group it is.
   */
  { header: "Sheet", width: 24, value: (_group, sheet) => sheet },
  { header: "Group", width: 26, value: (group) => group.link.audienceLabel },
  { header: "Teacher", width: 22, value: (group) => group.link.teacher },
  { header: "Children", width: 10, value: (group) => group.link.rosterSize },
  { header: "Answered", width: 10, value: (group) => group.link.studentsAnswered },
  { header: "To review", width: 11, value: (group) => group.link.changesPending },
  {
    header: "Sent",
    width: 10,
    // The first question about a round gone quiet is whether it was ever
    // actually handed over.
    value: (group) => (group.link.sentAt ? "yes" : "not yet"),
  },
  {
    header: "Status",
    width: 14,
    value: (group) =>
      group.link.archivedAt ? `${group.link.status} (archived)` : group.link.status,
  },
];

const SUMMARY_COLUMNS: ExportColumn<Flat>[] = SUMMARY_FIELDS.map((field) => ({
  header: field.header,
  width: field.width,
  value: (row) => row[field.header] ?? null,
}));

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new Response("Not signed in", { status: 401 });
    }
    throw error;
  }

  // A link ending in .xlsx is what makes a browser save rather than navigate.
  // Accept the id either way rather than having two routes — same as the
  // per-request export.
  const { id } = await params;
  const collected = await collectedForBatch(id.replace(/\.xlsx$/i, ""));
  if (!collected) return new Response("No such round.", { status: 404 });

  const { batch, groups } = collected;
  if (groups.length === 0) {
    return new Response("That round has no links left.", { status: 404 });
  }

  /*
   * Sheet names decided up front, so the Summary can print the ones actually
   * written. buildWorkbook runs uniqueSheetName again on these; by then they
   * are already unique and already safe, so it is a no-op.
   */
  const used = new Set<string>();
  const named = groups.map((group) => ({
    group,
    sheet: uniqueSheetName(group.link.audienceLabel, used),
  }));

  const summary: Flat[] = named.map(({ group, sheet }) =>
    Object.fromEntries(
      SUMMARY_FIELDS.map((field) => [field.header, field.value(group, sheet)]),
    ),
  );

  const sheets = [
    { name: "Summary", rows: summary, columns: SUMMARY_COLUMNS },
    ...named.map(({ group, sheet }) => ({
      name: sheet,
      rows: group.rows.map((row) => flatten(row, group)),
      columns: columnsFor(group),
    })),
  ];

  const name = `sampark-round-${batch.title}-${batch.dueDate}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  const file = await buildWorkbook(sheets, SUMMARY_COLUMNS);

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
 * One child's row on a group's sheet.
 *
 * KEYED BY FIELD KEY, not by the header string the marks export uses. Two
 * field_defs rows are free to carry the same label_en — the registry's key is
 * the primary key, the label is just display — and a header-keyed bag would
 * silently collapse them into one column. Do not "simplify" this back.
 */
function flatten(row: CollectedRow, group: CollectedGroup): Flat {
  const flat: Flat = {
    srNo: row.srNo,
    studentId: row.studentId,
    name: row.name,
    classLabel: row.classLabel,
    route: row.route,
    outcome: row.outcome,
    reviewStatus: row.reviewStatus,
  };

  for (const field of group.fields) {
    flat[`sent:${field.key}`] = row.sent[field.key] ?? null;
    flat[`got:${field.key}`] = row.answered[field.key] ?? null;
  }

  return flat;
}

function columnsFor(group: CollectedGroup): ExportColumn<Flat>[] {
  const columns: ExportColumn<Flat>[] = [
    // SR no leads, because it is what the fee app joins on when this file goes
    // back out.
    { header: "SR no", width: 12, value: (row) => row.srNo },
    { header: "Student ID", width: 14, value: (row) => row.studentId },
    { header: "Name", width: 26, value: (row) => row.name },
  ];

  // Only when the group spans registers. A class link's sheet is already named
  // for its class; a subject link is eighty-four children from three of them.
  if (group.classLabels.length > 1) {
    columns.push({ header: "Class", width: 12, value: (row) => row.classLabel });
  }

  columns.push({ header: "Route", width: 20, value: (row) => row.route });

  for (const field of group.fields) {
    /*
     * ONE COLUMN FOR A MARK, the sent/teacher pair for everything else.
     *
     * The pair exists so a correction can be read against what it corrected —
     * essential for a phone number, meaningless for a mark, which is collected
     * rather than confirmed and has nothing on the other side. A "(sent)"
     * column blank for every child in the school is exactly the empty column
     * buildWorkbook's own note argues against, and dropping it is what turns
     * this sheet into the marks layout without a second code path.
     */
    if (field.recordKind === FA_MARKS_KIND) {
      columns.push({
        header: field.labelEn,
        width: 14,
        value: (row) => row[`got:${field.key}`] ?? null,
      });
      continue;
    }
    columns.push(
      {
        header: `${field.labelEn} (sent)`,
        width: 18,
        value: (row) => row[`sent:${field.key}`] ?? null,
      },
      {
        header: `${field.labelEn} (teacher)`,
        width: 18,
        value: (row) => row[`got:${field.key}`] ?? null,
      },
    );
  }

  columns.push(
    { header: "Outcome", width: 14, value: (row) => row.outcome },
    { header: "Review", width: 14, value: (row) => row.reviewStatus },
  );

  return columns;
}
