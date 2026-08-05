"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth/session";

/**
 * One message for every failure — unknown email, wrong password, disabled
 * account. Same reasoning as the teacher surface's identical 404: never tell
 * the person at the keyboard which half they got right.
 */
const GENERIC_FAILURE = "Email or password is not correct.";

export async function loginAction(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return "Enter your email and password.";

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return null;
  } catch (error) {
    // A successful sign-in throws NEXT_REDIRECT. Only AuthError is a failure;
    // swallowing everything here would turn a working login into a dead form.
    if (error instanceof AuthError) return GENERIC_FAILURE;
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
