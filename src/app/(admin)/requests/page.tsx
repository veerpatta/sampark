import Link from "next/link";
import { listRequests } from "@/lib/requests";
import { DataTable, type Column } from "@/components/admin/DataTable";

export const metadata = { title: "Requests — Sampark" };
export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listRequests>>[number];

/**
 * Every request, and how far each has got.
 *
 * A table at md and up, a stack of cards below it — a seven-column table on a
 * 390px phone puts the two columns that matter (answered, to review) off the
 * right edge. See components/admin/DataTable.
 */
export default async function RequestsPage() {
  const requests = await listRequests();
  const today = new Date().toISOString().slice(0, 10);

  const columns: Column<Row>[] = [
    {
      key: "class",
      header: "Class",
      role: "secondary",
      cell: (request) => request.classLabel,
      cellClassName: "font-medium",
    },
    {
      key: "title",
      header: "Request",
      role: "primary",
      cell: (request) => (
        <Link
          href={`/requests/${request.id}`}
          className="font-medium text-[var(--color-brand-600)] hover:underline md:inline"
        >
          {request.title}
        </Link>
      ),
    },
    {
      key: "teacher",
      header: "Teacher",
      cell: (request) => request.teacher,
      cellClassName: "text-[var(--color-ink-muted)]",
    },
    {
      key: "answered",
      header: "Answered",
      cell: (request) => (
        <span
          className={`font-mono text-xs ${
            request.studentsAnswered >= request.rosterSize && request.rosterSize > 0
              ? "font-medium text-[var(--color-success)]"
              : ""
          }`}
        >
          {request.studentsAnswered} / {request.rosterSize}
        </span>
      ),
    },
    {
      key: "review",
      header: "To review",
      cell: (request) =>
        request.changesPending > 0 ? (
          <Link
            href={`/review?request=${request.id}`}
            className="rounded bg-[var(--color-correct-bg)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-correct-fg)] hover:underline"
          >
            {request.changesPending}
          </Link>
        ) : (
          <span className="font-mono text-xs text-[var(--color-ink-muted)]">—</span>
        ),
    },
    {
      key: "due",
      header: "Due",
      cell: (request) => (
        <span
          className={
            request.dueDate < today && request.status === "open"
              ? "font-medium text-[var(--color-danger)]"
              : ""
          }
        >
          {request.dueDate}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (request) => (
        <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
          {request.status}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {requests.length} request{requests.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/requests/new"
          className="flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--color-brand-600)] px-4 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
        >
          New request
        </Link>
      </header>

      <DataTable
        columns={columns}
        rows={requests}
        rowKey={(request) => request.id}
        empty="No requests yet. Create one and you get a link to send on WhatsApp."
      />

      {requests.length > 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          &ldquo;Answered&rdquo; counts students the teacher has responded for,
          however she answered. &ldquo;To review&rdquo; counts only the answers
          that differ from what she was sent.
        </p>
      ) : null}
    </div>
  );
}
