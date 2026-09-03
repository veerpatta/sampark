import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import { db, schema } from "./db";
import {
  documentPathname,
  MAX_DOCUMENT_BYTES,
  sniffDocument,
  type DocumentKind,
} from "./documents";

/**
 * SERVER ONLY. Reads and writes the bytes behind student_documents.
 *
 * Mirrors the office's photo route (app/api/photos/route.ts) in the order it
 * does things, because the order is the correctness:
 *
 *   BYTES FIRST, DATABASE SECOND on the way in. A put that succeeds followed
 *   by an insert that fails leaves an unreferenced blob, which costs storage
 *   and nothing else. The other order leaves a row naming bytes that were never
 *   stored — a document the office believes it holds and does not.
 *
 *   DATABASE FIRST, BYTES SECOND on the way out. Stamping `removed_at` is what
 *   stops /api/documents serving the file; the blob delete is housekeeping.
 *   If it fails the bytes linger under an unguessable pathname that nothing
 *   references, which is the same harmless state as the first case.
 */

export type DocumentRow = {
  id: string;
  kind: string;
  label: string | null;
  pathname: string;
  contentType: string;
  bytes: number;
  uploadedAt: Date;
  uploadedByName: string;
  removedAt: Date | null;
  removedByName: string | null;
};

const uploader = schema.users;

export async function listDocuments(
  studentId: string,
  options: { includeRemoved?: boolean } = {},
): Promise<DocumentRow[]> {
  const rows = await db
    .select({
      id: schema.studentDocuments.id,
      kind: schema.studentDocuments.kind,
      label: schema.studentDocuments.label,
      pathname: schema.studentDocuments.pathname,
      contentType: schema.studentDocuments.contentType,
      bytes: schema.studentDocuments.bytes,
      uploadedAt: schema.studentDocuments.uploadedAt,
      uploadedByName: uploader.name,
      removedAt: schema.studentDocuments.removedAt,
      removedBy: schema.studentDocuments.removedBy,
    })
    .from(schema.studentDocuments)
    .innerJoin(uploader, eq(uploader.id, schema.studentDocuments.uploadedBy))
    .where(
      options.includeRemoved
        ? eq(schema.studentDocuments.studentId, studentId)
        : and(
            eq(schema.studentDocuments.studentId, studentId),
            isNull(schema.studentDocuments.removedAt),
          ),
    )
    .orderBy(desc(schema.studentDocuments.uploadedAt));

  // The remover's name, resolved separately: a second self-join on users for a
  // column that is null on every live row is not worth the query shape.
  const removerIds = [...new Set(rows.map((row) => row.removedBy).filter(Boolean))] as string[];
  const removers = new Map<string, string>();
  if (removerIds.length > 0) {
    const people = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, removerIds));
    for (const person of people) removers.set(person.id, person.name);
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    pathname: row.pathname,
    contentType: row.contentType,
    bytes: row.bytes,
    uploadedAt: row.uploadedAt,
    uploadedByName: row.uploadedByName,
    removedAt: row.removedAt,
    removedByName: row.removedBy ? (removers.get(row.removedBy) ?? null) : null,
  }));
}

/** The row the read proxy needs, by pathname, only while the document is live. */
export async function findLiveDocument(pathname: string) {
  const [row] = await db
    .select({
      id: schema.studentDocuments.id,
      studentId: schema.studentDocuments.studentId,
      kind: schema.studentDocuments.kind,
      contentType: schema.studentDocuments.contentType,
    })
    .from(schema.studentDocuments)
    .where(
      and(
        eq(schema.studentDocuments.pathname, pathname),
        isNull(schema.studentDocuments.removedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type AddDocumentResult =
  | { ok: true; id: string; pathname: string }
  | { ok: false; status: 413 | 415; error: string };

export async function addDocument(input: {
  studentId: string;
  kind: DocumentKind;
  label: string | null;
  bytes: Uint8Array;
  uploadedBy: string;
}): Promise<AddDocumentResult> {
  if (input.bytes.length === 0 || input.bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, status: 413, error: "That file is too large. Eight megabytes is the most a document can be." };
  }
  const sniffed = sniffDocument(input.bytes);
  if (!sniffed) {
    return { ok: false, status: 415, error: "Only a JPEG, a PNG or a PDF can be attached." };
  }

  const pathname = documentPathname(input.studentId, sniffed.ext);

  await put(pathname, Buffer.from(input.bytes), {
    access: "private",
    contentType: sniffed.contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31_536_000,
  });

  const [row] = await db
    .insert(schema.studentDocuments)
    .values({
      studentId: input.studentId,
      kind: input.kind,
      label: input.label,
      pathname,
      contentType: sniffed.contentType,
      bytes: input.bytes.length,
      uploadedBy: input.uploadedBy,
    })
    .returning({ id: schema.studentDocuments.id });

  return { ok: true, id: row!.id, pathname };
}

/**
 * Mark a document removed and delete its bytes.
 *
 * `AND removed_at IS NULL` in the UPDATE is what makes a double tap a no-op:
 * the second one claims nothing, returns nothing, and deletes nothing.
 */
export async function removeDocument(
  id: string,
  removedBy: string,
): Promise<{ removed: boolean; studentId: string | null }> {
  const [row] = await db
    .update(schema.studentDocuments)
    .set({ removedAt: new Date(), removedBy })
    .where(
      and(eq(schema.studentDocuments.id, id), isNull(schema.studentDocuments.removedAt)),
    )
    .returning({
      pathname: schema.studentDocuments.pathname,
      studentId: schema.studentDocuments.studentId,
    });

  if (!row) return { removed: false, studentId: null };

  // Housekeeping, not correctness: the row already says the document is gone.
  await del(row.pathname).catch(() => undefined);

  return { removed: true, studentId: row.studentId };
}
