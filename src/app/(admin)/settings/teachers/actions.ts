"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { generateToken } from "@/lib/auth/token";
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
  //
  // Deactivating also kills her durable link. resolveTeacherToken already
  // refuses an inactive teacher, so this is belt and braces — but "she left"
  // and "her link died" should be one act, and a token merely lying inert is a
  // token that comes back if somebody reactivates her by accident.
  await db
    .update(schema.teachers)
    .set(active ? { active } : { active, linkToken: null, linkIssuedAt: null })
    .where(eq(schema.teachers.id, id));

  revalidatePath("/settings/teachers");
}

/**
 * Issue her durable link — or rotate it. The same call.
 *
 * Rotation is one UPDATE that overwrites the old value, so the old URL is dead
 * the instant it commits. There is no window in which both work, and no second
 * column anybody has to remember to set.
 *
 * NOT uniqueTokens(): that helper checks requests.token, which is the wrong
 * table. A collision there would be harmless here — the two are resolved by
 * different columns — so the check has to be against the column this token
 * actually lives in.
 */
export async function issueTeacherLink(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateToken();
    const [taken] = await db
      .select({ id: schema.teachers.id })
      .from(schema.teachers)
      .where(eq(schema.teachers.linkToken, candidate))
      .limit(1);
    if (taken) continue;

    await db
      .update(schema.teachers)
      .set({ linkToken: candidate, linkIssuedAt: new Date() })
      .where(eq(schema.teachers.id, id));
    revalidatePath("/settings/teachers");
    return;
  }
  throw new Error("Could not generate a unique link. Try again.");
}

/** Kill one teacher's link. NULL is the revocation — see the schema comment. */
export async function revokeTeacherLink(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await db
    .update(schema.teachers)
    .set({ linkToken: null, linkIssuedAt: null })
    .where(eq(schema.teachers.id, id));

  revalidatePath("/settings/teachers");
}

/**
 * The global off switch. One statement, every teacher, no loop.
 *
 * A flag would only MUTE: turn it back on and every dormant URL — including
 * whichever one leaked while it was off — is live again. Revocation destroys,
 * which for a bearer credential is the only thing that means anything. It is
 * also not an environment variable, because lib/db.ts already documents that
 * env changes need a redeploy, and a kill switch whose latency is a build is
 * not a kill switch. The person pulling it is the owner on a phone; she has the
 * console and not the Vercel dashboard.
 *
 * The cost, stated plainly: after this, getting back to zero-message rounds
 * means one grouped send again — about sixteen messages. That path is not
 * removed by the durable link and must never be.
 */
export async function revokeAllTeacherLinks() {
  await requireOwner();
  await db
    .update(schema.teachers)
    .set({ linkToken: null, linkIssuedAt: null })
    .where(isNotNull(schema.teachers.linkToken));

  revalidatePath("/settings/teachers");
}
