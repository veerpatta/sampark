/**
 * The one HTTP call to AiSensy.
 *
 * SERVER ONLY. This file reads the API key, and lib/db.ts's rule applies to it
 * unchanged: nothing a "use client" component imports may import this. The
 * text of the templates and the values that fill them live in
 * lib/whatsapp-templates.ts, which is pure and may be imported anywhere; this
 * file only knows how to put a payload on the wire.
 *
 * WHAT THE API IS. AiSensy wraps the WhatsApp Business API as "campaigns": for
 * each approved template the office creates an API campaign in the dashboard,
 * names it, and sets it Live. A send is then one POST naming that campaign,
 * the number, and the values for the template's holes. The campaign name is
 * the contract — `campaignFor` derives it from the template kind and language
 * so it cannot be typed differently in two places.
 *
 * WHAT A FAILURE LOOKS LIKE. A non-200, or a 200 whose body carries `error`.
 * The message is passed through verbatim to the log and to the screen, because
 * "Template params does not match the campaign!" is more use to whoever fixes
 * it than any paraphrase — it is the exact sentence to search the dashboard
 * for. The key is never logged, never returned, never in an error message.
 *
 * THE KEY IS SET IN PRODUCTION ONLY. A template's button opens the production
 * domain; a preview deployment runs against a branch database whose tokens
 * production does not hold, so a message sent from a preview would deliver a
 * link that 404s on the teacher's phone. With the key unset, isApiConfigured()
 * is false and every send button quietly becomes the wa.me link it used to be.
 */

import { isCompletePhone, normalisePhone } from "./phone";
import {
  templateName,
  type Language,
  type TemplateKind,
} from "./whatsapp-templates";

const ENDPOINT = "https://backend.aisensy.com/campaign/t1/api/v2";

/** How long one send may take before it is called failed. */
const TIMEOUT_MS = 15_000;

/** Whether sends can happen at all. Read at call time, not at import. */
export function isApiConfigured(): boolean {
  return Boolean(process.env.AISENSY_API_KEY?.trim());
}

/**
 * The campaign to name for a template.
 *
 * `AISENSY_CAMPAIGN_PREFIX` exists for a second project or a rename in the
 * dashboard; unset, the campaigns are named exactly as the templates are.
 */
export function campaignFor(kind: TemplateKind, language: Language): string {
  const prefix = process.env.AISENSY_CAMPAIGN_PREFIX?.trim();
  const name = templateName(kind, language);
  return prefix ? name.replace(/^sampark/, prefix) : name;
}

/**
 * "+91" and ten digits, or nothing.
 *
 * The same normalisation the rest of the app does (lib/phone.ts), then the
 * country code AiSensy wants. A number that is not ten digits is refused here
 * with a sentence rather than sent and refused by Meta with a code.
 */
export function destinationFor(phone: string): string | null {
  if (!isCompletePhone(phone)) return null;
  return `+91${normalisePhone(phone)}`;
}

export type SendResult =
  | { ok: true; raw: unknown }
  | { ok: false; error: string; raw: unknown; status: number | null };

/**
 * What AiSensy's answer means. Pure, and exported so the test can feed it the
 * shapes the API actually returns without a network.
 *
 * A 200 with `error` in the body is a failure — that is how a wrong campaign
 * name or a param-count mismatch comes back. A 200 without one is a success;
 * the body is kept whole as `raw` because its shape is not documented and the
 * log is the place to find out what it was.
 */
export function interpretResponse(status: number, body: unknown): SendResult {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const error = record && typeof record.error === "string" ? record.error : null;
  if (status >= 200 && status < 300 && !error) return { ok: true, raw: body };
  return {
    ok: false,
    error:
      error ??
      (record && typeof record.message === "string"
        ? record.message
        : `AiSensy answered ${status}`),
    raw: body,
    status,
  };
}

export type SendTemplateInput = {
  campaignName: string;
  /** Already in "+91…" form — see destinationFor. */
  destination: string;
  /** Becomes the contact's name in the AiSensy dashboard. */
  userName: string;
  templateParams: string[];
};

/** One message. Never throws: a network failure is a `SendResult` too. */
export async function sendTemplate(input: SendTemplateInput): Promise<SendResult> {
  const apiKey = process.env.AISENSY_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "AISENSY_API_KEY is not set.", raw: null, status: null };
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName: input.campaignName,
        destination: input.destination,
        userName: input.userName,
        source: "sampark",
        templateParams: input.templateParams,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `AiSensy did not answer within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Could not reach AiSensy.";
    return { ok: false, error: reason, raw: null, status: null };
  }

  let body: unknown = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return interpretResponse(response.status, body);
}
