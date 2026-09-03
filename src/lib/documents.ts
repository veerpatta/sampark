import { randomHex, STUDENT_ID_PATTERN } from "./photos";

/**
 * Everything that knows the shape of a document's blob pathname, and what a
 * document is allowed to be.
 *
 * NO NODE IMPORTS IN HERE, for the reason lib/photos.ts gives: the uploader is
 * a client component and reads DOCUMENT_KINDS and MAX_DOCUMENT_BYTES from this
 * file, and a `node:` import at the top would put a polyfill in the bundle.
 *
 * A document travels as ONE STRING — the pathname of a private Vercel Blob —
 * exactly as a photograph does. Never a URL: a private blob has no durable
 * public URL, and a public one would be a live credential to a scan of a
 * child's Aadhaar card. Resolving the pathname to bytes needs the store token,
 * which lives on the server, so /api/documents re-checks the session on every
 * read.
 *
 * THE VALIDATION HERE IS A SECURITY CONTROL. `documentBelongsTo` is a segment
 * comparison, never `startsWith` — `documents/S1001x/...` must not pass for
 * S1001 — and the sniffers below decide the content type from the bytes, never
 * from what the browser claimed. There is a test for each.
 */

export const DOCUMENT_KINDS = [
  { key: "tc", label: "Transfer certificate" },
  { key: "aadhaar", label: "Aadhaar card" },
  { key: "jan_aadhaar", label: "Jan Aadhaar card" },
  { key: "birth_certificate", label: "Birth certificate" },
  { key: "marksheet", label: "Mark sheet" },
  { key: "caste_certificate", label: "Caste certificate" },
  { key: "other", label: "Other" },
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["key"];

export function isDocumentKind(value: unknown): value is DocumentKind {
  return DOCUMENT_KINDS.some((kind) => kind.key === value);
}

export function documentKindLabel(kind: string): string {
  return DOCUMENT_KINDS.find((entry) => entry.key === kind)?.label ?? kind;
}

export type DocumentExt = "jpg" | "png" | "pdf";

/**
 * The whole pathname, anchored.
 *
 * `documents/<id>/<YYYYMMDD>-<24 hex>.<jpg|png|pdf>`
 *
 * Student id first, so ownership is a segment comparison and a per-student
 * `list({ prefix })` stays possible. Twelve random bytes make it unguessable.
 * A different top-level segment from the photographs, so neither proxy can be
 * talked into serving the other's files.
 */
const PATHNAME = /^documents\/([A-Za-z0-9_-]{1,32})\/\d{8}-[0-9a-f]{24}\.(jpg|png|pdf)$/;

export function isDocumentPathname(value: unknown): value is string {
  return typeof value === "string" && PATHNAME.test(value);
}

export function documentBelongsTo(value: unknown, studentId: string): boolean {
  const match = typeof value === "string" ? PATHNAME.exec(value) : null;
  return match !== null && match[1] === studentId;
}

/** A fresh, unguessable pathname for one upload. Never reused, never overwritten. */
export function documentPathname(
  studentId: string,
  ext: DocumentExt,
  now = new Date(),
): string {
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    throw new Error("Unusable student id for a document pathname.");
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
    .format(now)
    .replace(/-/g, "");
  return `documents/${studentId}/${day}-${randomHex(12)}.${ext}`;
}

/**
 * What the bytes actually are.
 *
 * `file.type` is whatever the client said. The magic bytes are what
 * distinguish a scan from an HTML page with a .pdf name — which matters because
 * the read proxy serves these back with the content type recorded here, under
 * `nosniff`, so the type we declare has to be true.
 */
export function sniffDocument(
  bytes: Uint8Array,
): { ext: DocumentExt; contentType: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > png.length && png.every((byte, i) => bytes[i] === byte)) {
    return { ext: "png", contentType: "image/png" };
  }
  // "%PDF-"
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length > pdf.length && pdf.every((byte, i) => bytes[i] === byte)) {
    return { ext: "pdf", contentType: "application/pdf" };
  }
  return null;
}

/**
 * Eight megabytes. A phone photograph of a certificate is two to four; a
 * scanner's PDF of one page is under one. Anything bigger is not a document,
 * it is a mistake, and the uploader says so before sending it.
 */
export const MAX_DOCUMENT_BYTES = 8_000_000;

export const DOCUMENT_ACCEPT = "image/jpeg,image/png,application/pdf";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
