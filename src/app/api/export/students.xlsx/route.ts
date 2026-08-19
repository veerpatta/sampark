import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook } from "@/lib/excel";
import { listStudents } from "@/lib/students";
import { parseFilters } from "@/lib/student-filters";
import { compareClassLabels } from "@/lib/classes";
import { fetchPhotos } from "@/lib/photo-store";
import { studentExportColumns } from "@/lib/student-export";
import { todayISO } from "@/lib/today";
import type { Student } from "../../../../../drizzle/schema";

/**
 * The master record as a clean .xlsx, one sheet per class.
 *
 * Principle 9: the office runs on Excel. This is the file that goes back to PSP
 * after a correction round, so the column order matches what the importer
 * expects to read — export, fix elsewhere, re-import, and the round trip works
 * without anyone renaming a header.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new Response("Not signed in", { status: 401 });
    }
    throw error;
  }

  /*
   * THE EXPORT FOLLOWS THE BOARD, not just its class.
   *
   * It used to read `?class=` alone, so filtering the students board to a house
   * or to "no mobile number" and then pressing Export handed over a completely
   * different set of children — with nothing on the file to say which. The
   * board builds this link from the same query string it is rendering, and
   * parseFilters is the one place that reads it, so the two cannot disagree.
   */
  const url = new URL(request.url);
  const params = Object.fromEntries(
    [...new Set([...url.searchParams.keys()])].map((key) => [
      key,
      url.searchParams.getAll(key),
    ]),
  );
  const { query } = parseFilters(params);

  // No pagination: the whole point is one file with everyone the board is
  // showing, and at ~2,000 students that is a small workbook.
  const { students } = await listStudents({
    ...query,
    limit: 10_000,
    offset: 0,
  });

  if (students.length === 0) {
    return new Response("No students to export.", { status: 404 });
  }

  const byClass = new Map<string, Student[]>();
  for (const student of students) {
    const list = byClass.get(student.classLabel) ?? [];
    list.push(student);
    byClass.set(student.classLabel, list);
  }

  const sheets = [...byClass.keys()]
    .sort(compareClassLabels)
    .map((label) => ({ name: label, rows: byClass.get(label)! }));

  // Opt OUT, not in: the office asked for this file so it could print faces,
  // and an export that quietly leaves them behind is the bug being fixed here.
  // `?photos=0` is for the case where somebody wants the columns in a hurry.
  const withPhotos = url.searchParams.get("photos") !== "0";
  const photos = withPhotos ? await fetchPhotos(students) : new Map();

  const file = await buildWorkbook(sheets, studentExportColumns(photos));
  // The school's date, not the server's. The office files these by class and
  // date, and one downloaded after midnight IST used to be stamped yesterday.
  const stamp = todayISO();
  // Named after the single class when that is all the filter is, because the
  // office files these by class. Any richer filter gets the general name rather
  // than a filename trying to describe six dimensions.
  const onlyClass =
    query.classes?.length === 1 && sheets.length === 1 ? query.classes[0] : null;
  const name = onlyClass
    ? `sampark-class-${onlyClass}-${stamp}`
    : `sampark-students-${stamp}`;

  return new Response(new Uint8Array(file), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[^a-zA-Z0-9-]/g, "-")}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
