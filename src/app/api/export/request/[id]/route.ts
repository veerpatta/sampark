import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { buildWorkbook, type ExportColumn } from "@/lib/excel";
import { collectedFor, type CollectedRow } from "@/lib/requests";

/**
 * What one request collected, as .xlsx.
 *
 * Carries both the value that was sent to the teacher and the value she gave
 * back. A file with only the new number would make it impossible to see later
 * what a correction actually corrected — and this file is what gets forwarded
 * to PSP or attached to an email, long after the review queue is empty.
 *
 * The FA marks export is a separate route: it has to match LEAD's existing
 * FA_Marks_Pattern.xlsx exactly rather than being shaped like this one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // The plan writes this route as /api/export/request/[id].xlsx, and a link
  // ending in .xlsx is what makes a browser save rather than navigate. Accept
  // the id with or without the suffix rather than having two routes.
  const { id } = await params;
  const requestId = id.replace(/\.xlsx$/i, "");

  const collected = await collectedFor(requestId);
  if (!collected) return new Response("No such request.", { status: 404 });

  const { request, teacher, fields, rows } = collected;

  const columns: ExportColumn<CollectedRow>[] = [
    { header: "Roll No", width: 9, value: (row) => row.rollNo },
    { header: "Student ID", width: 14, value: (row) => row.studentId },
    { header: "Name", width: 26, value: (row) => row.name },
    { header: "Father's Name", width: 24, value: (row) => row.fatherName },
    ...fields.flatMap((field): ExportColumn<CollectedRow>[] => [
      {
        header: `${field.labelEn} (sent)`,
        width: 18,
        value: (row) => row.sent[field.key] ?? null,
      },
      {
        header: `${field.labelEn} (teacher)`,
        width: 18,
        value: (row) => row.answered[field.key] ?? null,
      },
    ]),
    { header: "Outcome", width: 14, value: (row) => row.outcome },
    { header: "Review", width: 14, value: (row) => row.reviewStatus },
  ];

  const file = await buildWorkbook(
    [{ name: `Class ${request.classLabel}`, rows }],
    columns,
  );

  const name = `sampark-${request.title}-${request.classLabel}-${request.dueDate}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return new Response(new Uint8Array(file), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
      "cache-control": "no-store",
      // Not sensitive, but it saves the office asking "which teacher was this?"
      "x-sampark-teacher": encodeURIComponent(teacher.name),
    },
  });
}
