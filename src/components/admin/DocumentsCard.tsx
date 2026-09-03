import { Card } from "./Card";
import { DocumentUploader } from "./DocumentUploader";
import { RemoveDocumentButton } from "./RemoveDocumentButton";
import { formatDay } from "./Timeline";
import { documentKindLabel, formatBytes } from "@/lib/documents";
import type { DocumentRow } from "@/lib/document-store";

/**
 * The certificates the office holds for one child.
 *
 * "Open" is a real link in a new tab: the proxy re-checks the session, the
 * browser renders a PDF or an image natively, and nothing here has to know
 * which it got.
 */
export function DocumentsCard({
  studentId,
  documents,
  canEdit,
}: {
  studentId: string;
  documents: DocumentRow[];
  canEdit: boolean;
}) {
  const live = documents.filter((row) => !row.removedAt);

  return (
    <Card title="Documents" flush>
      {live.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
          No certificates attached yet.
          {canEdit ? " A transfer certificate, an Aadhaar card, a mark sheet — as a photo or a PDF." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {live.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {documentKindLabel(row.kind)}
                  {row.label ? <span className="font-normal text-[var(--color-ink-muted)]"> — {row.label}</span> : null}
                </span>
                <span className="block text-xs text-[var(--color-ink-muted)]">
                  {row.contentType === "application/pdf" ? "PDF" : "Image"} · {formatBytes(row.bytes)} · added by{" "}
                  {row.uploadedByName}, {formatDay(row.uploadedAt)}
                </span>
              </span>
              <a
                href={`/api/documents?p=${encodeURIComponent(row.pathname)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--tap-min)] items-center px-2 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
              >
                Open
              </a>
              {canEdit ? <RemoveDocumentButton id={row.id} what={documentKindLabel(row.kind)} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <DocumentUploader studentId={studentId} />
        </div>
      ) : null}
    </Card>
  );
}
