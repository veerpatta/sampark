"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { generateToken } from "@/lib/auth/token";
import {
  ensureOfficeRecipient,
  getOfficeRecipient,
  OfficeValidationError,
} from "@/lib/office";
import { sendTeacherLink, type SendOutcome } from "@/lib/whatsapp-send";

/**
 * Set the number every master link is sent to.
 *
 * OWNER ONLY — canManageSettings, the same gate the teacher editor and the
 * field registry sit behind. This number receives a link that reaches every
 * class in a round, so who may point it somewhere is the same question as who
 * may issue a teacher's durable link.
 *
 * IT IS TYPED HERE RATHER THAN COMMITTED. The repository is public. A personal
 * mobile number in a source file is published to everyone who clones it and
 * needs a redeploy to change; in the database it is editable from this screen
 * in seconds, by the person whose number it is.
 */
export async function saveOfficeNumber(
  formData: FormData,
): Promise<{ ok: boolean; error: string | null }> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { ok: false, error: "Only an owner can change the office number." };
  }

  try {
    await ensureOfficeRecipient({
      phone: String(formData.get("phone") ?? ""),
      name: String(formData.get("name") ?? ""),
      language: String(formData.get("language") ?? ""),
    });
  } catch (error) {
    if (error instanceof OfficeValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/settings/office");
  revalidatePath("/requests");
  return { ok: true, error: null };
}

/**
 * Issue or rotate the office's standing page — /t/<token>.
 *
 * ONE LINK SAVED ONCE, instead of one message per round. The master link for a
 * round is sent when the round is created and is the right thing for that
 * moment; this is for the other half of the habit, where somebody opens the
 * same bookmark on a Tuesday to see what is still open. It is the durable
 * teacher page, unchanged — the office is a row in `teachers`, so /t/ already
 * knows how to draw it, and the only thing that differs is that a photo or
 * Aadhaar round may appear on it (see isListableOnTeacherPage).
 *
 * ROTATION IS THE SAME UPDATE AS ISSUING. There is no revoked_at and no second
 * column to remember: the new token overwrites the old in one statement, so
 * the previous URL is dead the instant the new one exists.
 */
export async function issueOfficeLink(): Promise<{
  token: string | null;
  error: string | null;
}> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { token: null, error: "Only an owner can issue the office link." };
  }

  const office = await getOfficeRecipient();
  if (!office) {
    return { token: null, error: "Set the office number first." };
  }

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
      .where(eq(schema.teachers.id, office.id));
    revalidatePath("/settings/office");
    return { token: candidate, error: null };
  }

  return { token: null, error: "Could not generate a unique link. Try again." };
}

/**
 * Kill the office's standing page. NULL is the revocation.
 *
 * Worth knowing and worth saying on the screen: the global "revoke every link"
 * in Settings → Teachers kills this one too, because it nulls the column on
 * every row and the office is a row. That is correct for a kill switch — a
 * switch with an exception is not one — but it is a surprise if nobody wrote
 * it down.
 */
export async function revokeOfficeLink(): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { error: "Only an owner can revoke the office link." };
  }

  await db
    .update(schema.teachers)
    .set({ linkToken: null })
    .where(eq(schema.teachers.isOffice, true));
  revalidatePath("/settings/office");
  return { error: null };
}

/**
 * Send the office its own standing page, using the approved `link` template.
 *
 * The existing sendTeacherLink, with a new caller: the office is a teacher row,
 * so nothing about the send had to be invented.
 */
export async function sendOfficeLink(): Promise<SendOutcome> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { ok: false, error: "Only an owner can send the office link." };
  }

  const office = await getOfficeRecipient();
  if (!office) return { ok: false, error: "Set the office number first." };

  const outcome = await sendTeacherLink({ teacherId: office.id, actor: user.id });
  revalidatePath("/settings/office");
  return outcome;
}
