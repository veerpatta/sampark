/**
 * The record of what the app sent through the WhatsApp API.
 *
 * SERVER ONLY — imports the database. Reads for the boards ("sent via
 * WhatsApp · 10:42") and for the settings screen's recent list; one write, from
 * lib/whatsapp-send.ts, whether the send succeeded or not. See
 * whatsapp_messages in drizzle/schema.ts for why the rows are append-only.
 */

import { and, arrayOverlaps, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import type { Language, TemplateKind } from "./whatsapp-templates";

export type LogInput = {
  kind: TemplateKind;
  campaignName: string;
  language: Language;
  teacherId: string | null;
  phone: string;
  requestIds: string[];
  batchId: string | null;
  templateParams: string[];
  buttonSuffix: string;
  status: "sent" | "failed";
  error: string | null;
  providerResponse: unknown;
  sentBy: string | null;
};

export async function logMessage(input: LogInput): Promise<void> {
  await db.insert(schema.whatsappMessages).values({
    kind: input.kind,
    campaignName: input.campaignName,
    language: input.language,
    teacherId: input.teacherId,
    phone: input.phone,
    requestIds: input.requestIds,
    batchId: input.batchId,
    templateParams: input.templateParams,
    buttonSuffix: input.buttonSuffix,
    status: input.status,
    error: input.error,
    providerResponse: input.providerResponse ?? null,
    sentBy: input.sentBy,
  });
}

/** The last successful API send that covered a request, per request id. */
export type ApiSend = { at: Date; kind: string; language: string };

/**
 * When each request last went out through the API — the boards' provenance
 * line. Only successful sends: a failed attempt is not something she received.
 */
export async function latestApiSends(
  requestIds: string[],
): Promise<Map<string, ApiSend>> {
  const out = new Map<string, ApiSend>();
  if (requestIds.length === 0) return out;

  const rows = await db
    .select({
      requestIds: schema.whatsappMessages.requestIds,
      kind: schema.whatsappMessages.kind,
      language: schema.whatsappMessages.language,
      at: schema.whatsappMessages.createdAt,
    })
    .from(schema.whatsappMessages)
    .where(
      and(
        eq(schema.whatsappMessages.status, "sent"),
        arrayOverlaps(schema.whatsappMessages.requestIds, requestIds),
      ),
    )
    .orderBy(desc(schema.whatsappMessages.createdAt));

  for (const row of rows) {
    for (const id of row.requestIds) {
      if (!out.has(id)) out.set(id, { at: row.at, kind: row.kind, language: row.language });
    }
  }
  return out;
}

export type RecentMessage = {
  id: string;
  at: Date;
  kind: string;
  language: string;
  campaignName: string;
  teacherName: string | null;
  phone: string;
  status: string;
  error: string | null;
  requestCount: number;
};

/** The last few, newest first, for Settings → WhatsApp. */
export async function recentMessages(limit = 30): Promise<RecentMessage[]> {
  const rows = await db
    .select({
      id: schema.whatsappMessages.id,
      at: schema.whatsappMessages.createdAt,
      kind: schema.whatsappMessages.kind,
      language: schema.whatsappMessages.language,
      campaignName: schema.whatsappMessages.campaignName,
      phone: schema.whatsappMessages.phone,
      status: schema.whatsappMessages.status,
      error: schema.whatsappMessages.error,
      requestIds: schema.whatsappMessages.requestIds,
      teacherId: schema.whatsappMessages.teacherId,
    })
    .from(schema.whatsappMessages)
    .orderBy(desc(schema.whatsappMessages.createdAt))
    .limit(limit);

  const teacherIds = [...new Set(rows.map((row) => row.teacherId).filter((id): id is string => id !== null))];
  const teachers = teacherIds.length
    ? await db
        .select({ id: schema.teachers.id, name: schema.teachers.name })
        .from(schema.teachers)
        .where(inArray(schema.teachers.id, teacherIds))
    : [];
  const names = new Map(teachers.map((teacher) => [teacher.id, teacher.name]));

  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    language: row.language,
    campaignName: row.campaignName,
    teacherName: row.teacherId ? (names.get(row.teacherId) ?? row.teacherId) : null,
    phone: row.phone,
    status: row.status,
    error: row.error,
    requestCount: row.requestIds.length,
  }));
}
