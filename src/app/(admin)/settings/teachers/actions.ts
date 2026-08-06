"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import {
  isClassLabel,
  parseClassList,
  unknownClassLabelMessage,
} from "@/lib/classes";

/**
 * Teacher records are entered here, in the browser, and never in a seed file.
 * THE REPO IS PUBLIC and a teacher's mobile number is personal data — see
 * drizzle/seed/teachers.ts, which stays an empty placeholder on purpose.
 */
async function requireOwner() {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    throw new Error("Only the owner can edit the teacher list.");
  }
  return user;
}

export async function saveTeacher(formData: FormData) {
  await requireOwner();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");
  const classes = parseClassList(String(formData.get("classes") ?? ""));
  const active = formData.get("active") === "on";

  if (!id) throw new Error("Teacher ID is required.");
  if (!name) throw new Error("Name is required.");
  if (phone.length !== 10) {
    throw new Error("Phone must be exactly 10 digits, no country code.");
  }

  // A class typed here that does not exist in the fee app would silently never
  // match a student, and this teacher would simply never be offered as the
  // owner of that class. Refuse the whole submission and say which one.
  const unknown = classes.find((label) => !isClassLabel(label));
  if (unknown) throw new Error(unknownClassLabelMessage(unknown));

  await db
    .insert(schema.teachers)
    .values({ id, name, phone, classes, active })
    .onConflictDoUpdate({
      target: schema.teachers.id,
      set: { name, phone, classes, active },
    });

  revalidatePath("/settings/teachers");
}

export async function setTeacherActive(formData: FormData) {
  await requireOwner();

  const id = String(formData.get("id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  // Deactivate rather than delete: requests reference teacher_id, and a teacher
  // who left mid-year must not take her class's request history with her.
  await db
    .update(schema.teachers)
    .set({ active })
    .where(eq(schema.teachers.id, id));

  revalidatePath("/settings/teachers");
}
