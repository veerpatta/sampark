"use server";

import { revalidatePath } from "next/cache";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { ensureOfficeRecipient, OfficeValidationError } from "@/lib/office";

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
