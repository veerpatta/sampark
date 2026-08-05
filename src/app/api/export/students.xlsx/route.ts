import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook, type ExportColumn } from "@/lib/excel";
import { listStudents } from "@/lib/students";
import { compareClassLabels } from "@/lib/classes";
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

const COLUMNS: ExportColumn<Student>[] = [
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

  const url = new URL(request.url);
  const only = url.searchParams.get("class")?.trim() || undefined;

  // No pagination: the whole point is one file with everyone in it, and at
  // ~2,000 students that is a small workbook.
  const { students } = await listStudents({ classLabel: only, limit: 10_000 });

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

  const file = await buildWorkbook(sheets, COLUMNS);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = only ? `sampark-class-${only}-${stamp}` : `sampark-students-${stamp}`;

  return new Response(new Uint8Array(file), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[^a-zA-Z0-9-]/g, "-")}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
