import { NextResponse } from "next/server";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { CHILDREN_SHEET, MESSAGE_SHEET, TEMPLATE_HEADERS } from "@/lib/ask-list";
import { buildWorkbook, type ExportColumn } from "@/lib/excel";
import { todayISO } from "@/lib/today";

/**
 * The sheet the office fills in to ask about specific children.
 *
 * WHY A TEMPLATE RATHER THAN "UPLOAD ANY SPREADSHEET": the upload matches on
 * Student ID and then SR number and NEVER on name (standing rule 7), and a
 * sheet the office builds from scratch is a sheet with a Name column and not
 * much else. Handing over the right headers is cheaper than explaining the rule
 * after thirty-five rows have failed.
 *
 * TWO SHEETS. The children go down the rows of the first; the round's own
 * sentence is one free-form cell on the second, because a message repeated down
 * every row is an invitation to thirty-five different versions of it.
 *
 * The Name column is there so the office can check the sheet by eye, and is
 * read back only to describe a row that failed to match. It is never a key.
 */
export const runtime = "nodejs";

/** One worked row, and then the office's own. */
type Row = { id: string; srNo: string; name: string; note: string };

const CHILDREN_COLUMNS: ExportColumn<Row>[] = [
  { header: TEMPLATE_HEADERS.id, width: 14, value: (row) => row.id },
  { header: TEMPLATE_HEADERS.srNo, width: 12, value: (row) => row.srNo },
  { header: TEMPLATE_HEADERS.name, width: 26, value: (row) => row.name },
  { header: TEMPLATE_HEADERS.note, width: 46, value: (row) => row.note },
];

const MESSAGE_COLUMNS: ExportColumn<Row>[] = [
  { header: TEMPLATE_HEADERS.message, width: 80, value: (row) => row.note },
];

/*
 * ONE WORKED ROW, not an empty grid.
 *
 * Four headers and nothing under them do not say whether the note is per child
 * or per round, that either identifier will do, or that the name is ignored. A
 * single example answers all three, travels with the file, and is obviously an
 * example — so deleting it is the natural first thing to do.
 */
const EXAMPLE: Row = {
  id: "S1001",
  srNo: "",
  name: "— example row, delete it —",
  note: "This number belongs to an uncle. Please ask for the father's own.",
};

const MESSAGE_EXAMPLE: Row = {
  id: "",
  srNo: "",
  name: "",
  note: "These numbers are not on WhatsApp. Please send the family's WhatsApp number.",
};

export async function GET() {
  const session = await currentUser();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canCreateRequests(session.role)) {
    return NextResponse.json(
      { error: "Your role cannot create requests." },
      { status: 403 },
    );
  }

  // Per-sheet columns, which buildWorkbook takes precisely so one workbook can
  // hold sheets that do not share a header row — the marks export is the
  // existing case.
  const workbook = await buildWorkbook<Row>(
    [
      { name: CHILDREN_SHEET, rows: [EXAMPLE], columns: CHILDREN_COLUMNS },
      { name: MESSAGE_SHEET, rows: [MESSAGE_EXAMPLE], columns: MESSAGE_COLUMNS },
    ],
    CHILDREN_COLUMNS,
  );

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="sampark-ask-list-${todayISO()}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
