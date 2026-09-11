import { NextResponse } from "next/server";
import { inArray, or } from "drizzle-orm";
import {
  canCreateRequests,
  requireUser,
  UnauthorizedError,
} from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { parseTabularFile } from "@/lib/excel";
import {
  hasIdentityColumn,
  matchAskList,
  messageFrom,
  MESSAGE_SHEET,
  notesFrom,
} from "@/lib/ask-list";

/**
 * Read a list of children the office typed out, and say who it names.
 *
 * A ROUTE HANDLER AND NOT A SERVER ACTION, unlike the rest of the bulk send
 * beside it: the payload is multipart/form-data. Same reason
 * /api/students/import is one while requests/bulk/actions.ts is not.
 *
 * The file is read and thrown away. Nothing is parked server-side between this
 * call and the send — the student importer's decision, for the same reason:
 * there is no temp file holding a school's worth of identifiers waiting to be
 * cleaned up.
 *
 * NOTHING HERE WRITES, so the gate is canCreateRequests and not
 * canApproveIntoMaster. This chooses an audience, which the class and house
 * chips on the same screen already let the office do; it cannot touch a student
 * row, and every answer the round collects still goes through the review queue.
 */
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
/** Mirrors MAX_EXPLICIT_IDS in lib/students.ts, which refuses the rest. */
const MAX_ROWS = 3000;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw error;
  }

  if (!canCreateRequests(user.role)) {
    return NextResponse.json(
      { error: "Your role cannot create requests." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than 5 MB." },
      { status: 413 },
    );
  }

  const data = await file.arrayBuffer();

  let table;
  let messageSheet = null;
  try {
    table = await parseTabularFile(data, file.name);
    // The template puts the round's own sentence on a second sheet, so it can
    // be one free-form cell rather than a column repeated down every row.
    // Absent for a CSV, which has no sheets at all — an office that saved the
    // template as CSV has a round with no message, not a failed upload.
    if (table.sheets?.includes(MESSAGE_SHEET)) {
      messageSheet = await parseTabularFile(data, file.name, MESSAGE_SHEET);
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not read that file.",
      },
      { status: 400 },
    );
  }

  if (!hasIdentityColumn(table.headers)) {
    return NextResponse.json(
      {
        error:
          "That sheet has no Student ID and no SR number column. A name on its own cannot identify a child — download the template and paste the ids into it.",
      },
      { status: 400 },
    );
  }
  if (table.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That sheet has ${table.rows.length} rows, more than one round is meant to carry.` },
      { status: 400 },
    );
  }

  /*
   * Only the children the sheet could possibly name, not the whole school.
   *
   * EVERY STATUS, deliberately. A child who has left still has to be MATCHED so
   * the screen can say "no longer on the active roll" — matching only the
   * active ones would report her as an unknown id, which sends the office
   * hunting through a spreadsheet for a row that is perfectly correct.
   */
  const ids = collect(table.rows, table.headers, ID_HEADERS);
  const srNos = collect(table.rows, table.headers, SR_HEADERS);
  const candidates =
    ids.length === 0 && srNos.length === 0
      ? []
      : await db
          .select()
          .from(schema.students)
          .where(
            or(
              ids.length ? inArray(schema.students.id, ids) : undefined,
              srNos.length ? inArray(schema.students.srNo, srNos) : undefined,
            ),
          );

  const result = matchAskList(table, candidates);

  return NextResponse.json({
    matched: result.matched,
    unmatched: result.unmatched,
    classLabels: result.classLabels,
    studentIds: result.matched.map((row) => row.studentId),
    notes: notesFrom(result.matched),
    message: messageFrom(messageSheet),
  });
}

const ID_HEADERS = ["student id", "studentid", "student_id", "id", "vpps id", "sid"];
const SR_HEADERS = ["sr no", "sr_no", "srno", "sr number", "s.r. no", "sr"];

/**
 * The values in whichever column carries one of these headers.
 *
 * Used only to narrow the database read; the real matching is matchAskList's,
 * over the same sheet. Duplicated header lists would be a place for the two to
 * disagree about which column is the id, so both read from a list of aliases
 * and a miss here can only ever make the query wider, never the match wrong.
 */
function collect(
  rows: Record<string, string>[],
  headers: string[],
  aliases: string[],
): string[] {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const header = aliases
    .map((alias) => headers[lower.indexOf(alias)])
    .find(Boolean);
  if (!header) return [];

  return [
    ...new Set(
      rows.map((row) => String(row[header] ?? "").trim()).filter(Boolean),
    ),
  ];
}
