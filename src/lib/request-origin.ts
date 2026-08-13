import { headers } from "next/headers";

/**
 * The origin this page is actually being served from.
 *
 * WHY THE SERVER HAS TO ANSWER THIS. Every link the office hands to a teacher
 * is an absolute URL pasted into WhatsApp, and a client component cannot supply
 * one: `window` does not exist while the page is being rendered on the server,
 * so a component reaching for `window.location.origin` during render gets an
 * empty string, bakes `/t/abc` into the href, and React keeps that value
 * through hydration. The button looks right and the message it composes carries
 * a relative path, which is nothing at all once it leaves the browser.
 *
 * That is not hypothetical — it is what the dashboard's Remind button did.
 *
 * So the origin is read here, on the server, and passed down as a prop. The
 * send queue and the teacher settings panel already worked this way; this is
 * the same two lines they each had, in one place.
 *
 * `host` rather than a configured base URL because the console answers on
 * localhost, on a Vercel preview and on the real domain, and a link built from
 * the wrong one of those is a link the teacher cannot open. Anything that is
 * not localhost is https: Vercel terminates TLS in front of us, so the scheme
 * the request arrived with is not what the browser used.
 */
export async function requestOrigin(): Promise<string> {
  const host = (await headers()).get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}
