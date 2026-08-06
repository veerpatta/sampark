import { NextResponse } from "next/server";
import {
  canApproveIntoMaster,
  requireUser,
  UnauthorizedError,
} from "@/lib/auth/session";
import { parseTabularFile } from "@/lib/excel";
import {
  applyPreview,
  buildPreview,
  suggestColumnMap,
  type ColumnMap,
} from "@/lib/students-import";

/**
 * Student import — inspect, preview, apply.
 *
 * The file is uploaded again at every step rather than parked in server-side
 * storage between them. A PSP class export is a few hundred rows; re-parsing it
 * costs nothing and it means there is no temp file holding a school's worth of
 * Aadhaar numbers waiting to be cleaned up.
 *
 * `apply` rebuilds the plan from the file and the column map on the server. It
 * never accepts a write list from the browser — otherwise the confirm step
 * would be a hole straight through to the students table.
 */
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

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

  // Bulk-writing the master record is at least as consequential as approving a
  // single teacher correction, so it takes the same role. See open decision #4.
  if (!canApproveIntoMaster(user.role)) {
    return NextResponse.json(
      { error: "Your role cannot write to the student master record." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "inspect");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is larger than 5 MB. Split it by class and try again." },
      { status: 413 },
    );
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
    return NextResponse.json(
      { error: "Upload a .csv or .xlsx file." },
      { status: 400 },
    );
  }

  // Which sheet, for a multi-sheet workbook. Absent on the first inspect, which
  // is what lists the sheets in the first place.
  const wantedSheet = form.get("sheet");

  let table;
  try {
    table = await parseTabularFile(
      await file.arrayBuffer(),
      file.name,
      typeof wantedSheet === "string" && wantedSheet ? wantedSheet : null,
    );
  } catch {
    return NextResponse.json(
      { error: "That file could not be read. Re-save it as .csv or .xlsx." },
      { status: 400 },
    );
  }

  const sheets = table.sheets ?? [];

  if (table.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          sheets.length > 1
            ? `Sheet "${table.sheet ?? sheets[0]}" has no rows. Pick another sheet.`
            : "The file has headers but no rows.",
        sheets,
        sheet: table.sheet ?? null,
      },
      { status: 400 },
    );
  }

  if (mode === "inspect") {
    return NextResponse.json({
      headers: table.headers,
      rowCount: table.rows.length,
      suggestion: suggestColumnMap(table.headers),
      sample: table.rows.slice(0, 5),
      sheets,
      sheet: table.sheet ?? null,
    });
  }

  const map = parseMap(form.get("map"));
  if (!map) {
    return NextResponse.json({ error: "Column map missing." }, { status: 400 });
  }

  const plan = await buildPreview(table, map);

  if (mode === "preview") {
    return NextResponse.json({ rows: plan.rows, counts: plan.counts });
  }

  if (mode === "apply") {
    if (plan.counts.insert === 0 && plan.counts.update === 0) {
      return NextResponse.json(
        { error: "Nothing to write — this file changes nothing." },
        { status: 400 },
      );
    }
    const result = await applyPreview(plan);
    return NextResponse.json({ ...result, counts: plan.counts });
  }

  return NextResponse.json({ error: "Unknown mode." }, { status: 400 });
}

function parseMap(raw: FormDataEntryValue | null): ColumnMap | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ColumnMap;
  } catch {
    return null;
  }
}
