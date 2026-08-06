import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { countByClass, countByHouse, countByRoute } from "@/lib/students";
import { CLASS_LABELS } from "@/lib/classes";
import { HOUSES } from "@/lib/houses";
import { BUS_ROUTES } from "@/lib/routes";
import { TEMPLATES } from "@/lib/templates";
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
export default async function BulkSendPage() {
  const session = await currentUser();
  if (!session || !canCreateRequests(session.role)) redirect("/");

  const [classCounts, houseCounts, routeCounts, teachers, fields] =
    await Promise.all([
      countByClass(),
      countByHouse(),
      countByRoute(),
      db
        .select()
        .from(schema.teachers)
        .where(eq(schema.teachers.active, true))
        .orderBy(asc(schema.teachers.name)),
      db
        .select()
        .from(schema.fieldDefs)
        .where(eq(schema.fieldDefs.active, true))
        .orderBy(asc(schema.fieldDefs.sortOrder)),
    ]);

  const totalActive = [...classCounts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            Send to many
          </h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          One question, asked of several groups at once. Each teacher still gets
          her own link with only her own children on it.
        </p>
      </header>

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
        fields={fields.map((field) => ({
          key: field.key,
          labelEn: field.labelEn,
          labelHi: field.labelHi,
          mode: field.mode,
          needsPeriod: field.targetColumn === null,
        }))}
        templates={TEMPLATES}
        defaultPeriod={`${process.env.ACADEMIC_YEAR ?? "2026-27"}/FA1`}
      />
    </div>
  );
}
