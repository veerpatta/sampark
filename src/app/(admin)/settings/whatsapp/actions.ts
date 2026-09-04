"use server";

import { revalidatePath } from "next/cache";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { sendTest, type SendOutcome } from "@/lib/whatsapp-send";
import { isLanguage } from "@/lib/whatsapp-templates";

/**
 * A test message to any number.
 *
 * Owner-only, like the screen. It is the first thing to run after the
 * templates are approved and the campaigns set live: one send proves the
 * campaign name, the number of params and the button all line up, which is
 * three of the four ways this integration can be wrong. (The fourth — the
 * teacher's phone not being on WhatsApp — only a real send finds.)
 */
export async function sendTestViaApi(
  phone: string,
  language: string,
): Promise<SendOutcome> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { ok: false, error: "Only the owner can send a test." };
  }
  if (!isLanguage(language)) {
    return { ok: false, error: "Language must be Hindi or English." };
  }

  const outcome = await sendTest({ phone, language, actor: user.id });
  revalidatePath("/settings/whatsapp");
  return outcome;
}
