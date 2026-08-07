"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { isClassLabel, unknownClassLabelMessage } from "@/lib/classes";
import { subjectByKey } from "@/lib/subjects";

/**
 * Editing who teaches what.
 *
 * The timetable importer is a bootstrap; this is the thing that keeps the data
 * true afterwards. A subject changes hands mid-year and the office has to be
 * able to say so without anyone running a script — a CLI only a developer can
 * run means the second drift never gets recorded at all.
 *
 * Owner-only, matching the teacher editor next door: an assignment decides who
 * is asked for a whole class's marks, which is the same weight as deciding who
 * owns a class.
 */
async function requireOwner() {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    throw new Error("Only the owner can edit subject assignments.");
  }
  return user;
}

/**
 * Replace one teacher's classes for one subject.
 *
 * Scoped to (teacher, subject) rather than to the teacher as a whole, so two
 * people editing two different subjects cannot wipe each other's work — the
 * form only ever sends the checkboxes for the row that was open.
 *
 * Written as `office`, always. That is the flag the importer reads to know it
 * must not overwrite a hand correction on a later run.
 */
export async function saveSubjectClasses(formData: FormData) {
  await requireOwner();

  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const subjectKey = String(formData.get("subjectKey") ?? "").trim();
  if (!teacherId) throw new Error("Which teacher?");
  if (!subjectByKey(subjectKey)) throw new Error(`Unknown subject "${subjectKey}".`);

  const classLabels = formData
    .getAll("classLabel")
    .map((value) => String(value).trim())
    .filter(Boolean);

  for (const label of classLabels) {
    // Validated, never inferred. A label off the list would sit in the table
    // matching no student, and the subject fan-out would silently find nobody.
    if (!isClassLabel(label)) throw new Error(unknownClassLabelMessage(label));
  }

  await db
    .delete(schema.teacherSubjects)
    .where(
      and(
        eq(schema.teacherSubjects.teacherId, teacherId),
        eq(schema.teacherSubjects.subjectKey, subjectKey),
      ),
    );

  if (classLabels.length > 0) {
    await db.insert(schema.teacherSubjects).values(
      classLabels.map((classLabel) => ({
        teacherId,
        subjectKey,
        classLabel,
        assignedBy: "office",
      })),
    );
  }

  revalidatePath("/settings/subjects");
  revalidatePath("/requests/bulk");
}
