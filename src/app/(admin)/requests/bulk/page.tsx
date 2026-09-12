import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listPickableTeachers } from "@/lib/office";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import {
  countAudience,
  countByClass,
  countByHouse,
  countByRoute,
} from "@/lib/students";
import {
  audienceFromFilters,
  describeAudienceFilters,
  describeGaps,
  type StudentSearchParams,
} from "@/lib/student-filters";
import { CLASS_LABELS } from "@/lib/classes";
import { HOUSES } from "@/lib/houses";
import { BUS_ROUTES } from "@/lib/routes";
import { TEMPLATES } from "@/lib/templates";
import { PageHeader } from "@/components/admin/PageHeader";
import { BulkSend } from "./BulkSend";

export const metadata = { title: "Send to many — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Nineteen links in one go.
 *
 * The counts beside every chip are the point of loading them here: picking a
 * house that covers 38 children when you meant a class is a mistake the number
 * prevents before the preview has to explain it.
 */
export default async function BulkSendPage({
  searchParams,
}: {
  searchParams: Promise<StudentSearchParams>;
}) {
  const session = await currentUser();
  if (!session || !canCreateRequests(session.role)) redirect("/");

  /*
   * THE BOARD'S OWN FILTERS, READ WITH THE BOARD'S OWN PARSER.
   *
   * /students links here with the query string its Export link already
   * carries, so "Class 8, category SC, no photo" arrives intact. Parsing it
   * with anything other than parseFilters would be a second reading of one URL
   * — which is the drift lib/student-filters.ts exists to prevent, and the
   * failure would be a send quietly covering MORE children than the office was
   * looking at.
   */
  const params = await searchParams;
  const carried = audienceFromFilters(params);
  const carriedCount = carried ? await countAudience(carried) : 0;

  const [classCounts, houseCounts, routeCounts, teachers, fields, subjectRows] =
    await Promise.all([
      countByClass(),
      countByHouse(),
      countByRoute(),
      listPickableTeachers(),
      db
        .select()
        .from(schema.fieldDefs)
        .where(eq(schema.fieldDefs.active, true))
        .orderBy(asc(schema.fieldDefs.sortOrder)),
      // Only whether ANY exist — the mode card is offered or explained, and the
      // groups themselves are resolved server-side at preview time.
      db
        .select({ teacherId: schema.teacherSubjects.teacherId })
        .from(schema.teacherSubjects)
        .limit(1),
    ]);

  const totalActive = [...classCounts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      {/*
        THE TITLE MOVES INTO THE APP BAR ON A PHONE, like every other index
        screen here. This page was writing its own header, so "Send to many"
        was said twice above the fold — once in the bar and once at display
        size — and the sentence under it ran to three lines. Ninety-seven
        pixels of a 740px screen, spent before the office reaches the first
        thing it has to choose. The outline is intact: the h1 is `sr-only`
        below md, not absent.

        "back to the board" goes too: the app bar's own Back arrow already
        points there, and two ways back is one more thing to read.
      */}
      <PageHeader
        title="Send to many"
        subtitle="One question, asked of several groups at once. Each teacher still gets her own link with only her own children on it."
      />

      <BulkSend
        classes={CLASS_LABELS.map((label) => ({
          label,
          students: classCounts.get(label) ?? 0,
        }))}
        houses={HOUSES.map((house) => ({
          label: house.name,
          students: houseCounts.get(house.name) ?? 0,
        }))}
        routes={BUS_ROUTES.map((route) => ({
          label: route,
          students: routeCounts.get(route) ?? 0,
        }))}
        totalActive={totalActive}
        anyHouseOwner={teachers.some((teacher) => teacher.houses.length > 0)}
        anyRouteOwner={teachers.some((teacher) => teacher.routes.length > 0)}
        anySubjectTeacher={subjectRows.length > 0}
        fields={fields.map((field) => ({
          key: field.key,
          labelEn: field.labelEn,
          labelHi: field.labelHi,
          mode: field.mode,
          needsPeriod: field.targetColumn === null,
        }))}
        templates={TEMPLATES}
        defaultPeriod={`${process.env.ACADEMIC_YEAR ?? "2026-27"}/FA1`}
        carried={
          carried
            ? {
                audience: carried,
                count: carriedCount,
                summary: describeAudienceFilters(carried),
                gapReason: describeGaps(carried.gaps ?? [], carriedCount, "en"),
                gapReasonHi: describeGaps(carried.gaps ?? [], carriedCount, "hi"),
              }
            : null
        }
      />
    </div>
  );
}
