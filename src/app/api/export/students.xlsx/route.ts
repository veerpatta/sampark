import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook, type ExportColumn } from "@/lib/excel";
import { listStudents } from "@/lib/students";
import { parseFilters } from "@/lib/student-filters";
import { compareClassLabels } from "@/lib/classes";
import { fetchPhotos } from "@/lib/photo-store";
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

/**
 * The workbook's columns, given the photographs already fetched.
 *
 * A function rather than a constant because the Photo column has to close over
 * the images. Everything else is unchanged and still in the order the importer
 * reads, so export -> fix in Excel -> re-import still round-trips.
 */
const columnsFor = (photos: Map<string, Buffer>): ExportColumn<Student>[] => [
  { header: "Student ID", width: 14, value: (s) => s.id },
  { header: "SR No", width: 12, value: (s) => s.srNo },
  { header: "Admission No", width: 14, value: (s) => s.admissionNo },
  { header: "Class", width: 10, value: (s) => s.classLabel },
  { header: "Section", width: 9, value: (s) => s.section },
  { header: "Roll No", width: 9, value: (s) => s.rollNo },
  { header: "Name", width: 26, value: (s) => s.name },
  { header: "Father's Name", width: 24, value: (s) => s.fatherName },
  { header: "Mother's Name", width: 24, value: (s) => s.motherName },
  { header: "Mobile No", width: 14, value: (s) => s.phone },
  { header: "Alternate Mobile", width: 16, value: (s) => s.altPhone },
  { header: "Date of Birth", width: 13, value: (s) => s.dob },
  { header: "Gender", width: 9, value: (s) => s.gender },
  { header: "Category", width: 10, value: (s) => s.category },
  { header: "Aadhaar", width: 16, value: (s) => s.aadhaar },
  { header: "Jan Aadhaar", width: 16, value: (s) => s.janAadhaar },
  { header: "Village", width: 18, value: (s) => s.village },
  { header: "Address", width: 30, value: (s) => s.address },
  { header: "Bus Route", width: 14, value: (s) => s.busRoute },
  { header: "Status", width: 10, value: (s) => s.status },
  /*
   * THE PICTURE ITSELF, not a pathname and not "yes".
   *
   * A blob pathname in a spreadsheet is a dead string — unreadable to a person
   * and meaningless to PSP — and "yes" answers the wrong question. What the
   * office wants this file for is a printed class list with faces on it.
   *
   * `value` still fills the cell when there is no photograph, so the column
   * reads as a work list rather than as a row of holes.
   */
  {
    header: "Photo",
    width: 11,
    value: (s) => (s.photoPath ? "" : "no photo"),
    image: (s) => photos.get(s.id) ?? null,
  },
];

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

  const file = await buildWorkbook(sheets, columnsFor(photos));
  const stamp = new Date().toISOString().slice(0, 10);
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
