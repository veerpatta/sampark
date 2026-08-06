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
import { normaliseHouse } from "@/lib/houses";
import { isBusRoute, unknownRouteMessage } from "@/lib/routes";

/**
 * Read a repeated form field as a list.
 *
 * The editor sends one checkbox per assignment, so `getAll` returns many values;
 * the older single text input sent one comma-separated string. Joining and
 * reusing parseClassList covers both, and none of the three vocabularies —
 * class labels, house names, route names — contains a comma.
 */
function readList(formData: FormData, name: string): string[] {
  return parseClassList(
    formData
      .getAll(name)
      .map((value) => String(value))
      .join(","),
  );
}

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
  const classes = readList(formData, "classes");
  const houses = readList(formData, "houses");
  const routes = readList(formData, "routes");
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

  // Same reasoning for the other two, and the failure is quieter: a house or
  // route nobody owns simply drops out of a bulk send's recipient list, so a
  // misspelling here reads as "nobody is assigned" rather than as an error.
  const canonicalHouses = houses.map((house) => {
    const match = normaliseHouse(house);
    if (!match) {
      throw new Error(`"${house}" is not one of the four houses.`);
    }
    return match;
  });

  const badRoute = routes.find((route) => !isBusRoute(route));
  if (badRoute) throw new Error(unknownRouteMessage(badRoute));

  const values = {
    name,
    phone,
    classes,
    houses: canonicalHouses,
    routes,
    active,
  };

  await db
    .insert(schema.teachers)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: schema.teachers.id, set: values });

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
