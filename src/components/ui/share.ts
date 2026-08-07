/**
 * Open WhatsApp on the teacher's own chat, with the Hindi message ready.
 *
 * THIS USED TO OFFER THE NATIVE SHARE SHEET FIRST, AND THAT WAS THE BUG. The
 * sheet takes `{ text }` and nothing else — the Web Share API has no way to say
 * WHO — so it handed the office a message with no recipient and asked her to
 * find the teacher herself. On the targets that do not handle text well it was
 * simply a copy. Every send in this app already knows the number: it is on the
 * teacher's row, or overridden for the one request. Throwing that away and
 * making her search her contacts for the fortieth time in a marks round is work
 * the app was supposed to remove.
 *
 * So there is no sheet. wa.me carries the number and the body, WhatsApp opens
 * on that conversation, and she presses send.
 *
 * PREFER A REAL <a href target="_blank"> WHERE THE URL IS KNOWN AT RENDER TIME.
 * A browser never blocks a genuine link, and the admin page stays alive so the
 * "sent" tick can still be recorded. This helper exists for the one case that
 * cannot do that — QuickSend, which has to create the request and learn its
 * token before there is a URL at all.
 */
import { buildWhatsAppLink } from "@/lib/whatsapp";

export type OpenOutcome =
  /** A new tab took it; this page is still here and can record the send. */
  | "opened"
  /** The popup was blocked, so we left this page for WhatsApp instead. */
  | "navigated";

export function openWhatsApp({
  phone,
  message,
}: {
  phone: string;
  message: string;
}): OpenOutcome {
  // An empty number still produces a usable link — wa.me opens the contact
  // picker with the body attached, which is the honest fallback when the office
  // has no number saved. It should not happen: the fan-out blocks a group whose
  // teacher has none.
  const url = buildWhatsAppLink(phone, message);

  const tab = window.open(url, "_blank", "noopener,noreferrer");
  if (tab) return "opened";

  // Blocked — usually because this ran after an await and the browser no longer
  // counts it as a tap. Same tab rather than nothing.
  window.location.href = url;
  return "navigated";
}
