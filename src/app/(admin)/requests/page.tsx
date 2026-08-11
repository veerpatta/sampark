import Link from "next/link";
import { listRequests } from "@/lib/requests";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader } from "@/components/admin/PageHeader";
import { btn } from "@/components/ui/controls";
import { RequestBulkBar } from "./RequestBulkBar";

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
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  // Archived rows are reachable but never the default. An archive nobody can
  // open is a delete with extra steps, and the whole reason answered requests
  // are archived rather than deleted is that their contents still matter.
  const showArchived = (await searchParams).archived === "1";
  const requests = await listRequests({ includeArchived: showArchived });
  const today = new Date().toISOString().slice(0, 10);

  const columns: Column<Row>[] = [
    {
      key: "class",
      header: "Class",
      role: "secondary",
      cell: (request) => request.audienceLabel,
      cellClassName: "font-medium",
    },
    {
      key: "title",
      header: "Request",
      role: "primary",
      // Plain text: DataTable wraps the primary cell in the row's link itself.
      cell: (request) => request.title,
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
      // Holds a link of its own, so it stays off the card — where the card IS
      // the link and a second one inside it cannot be tapped.
      hideOnCard: true,
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
        <span className="flex flex-wrap items-center gap-1">
          <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
            {request.status}
          </span>
          {request.archivedAt ? (
            <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
              archived
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Requests"
        subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"}${
          showArchived ? ", archived included" : ""
        }`}
        actions={
          <Link
            href={showArchived ? "/requests" : "/requests?archived=1"}
            className={`${btn()} text-[var(--color-ink-muted)]`}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        }
      />

      {/* The two ways to start something, side by side and full width on a
          phone. They were in the header with "Show archived", which put three
          buttons of equal weight above the fold and none of them obviously
          first. */}
      <div className="flex gap-2">
        <Link
          href="/requests/new"
          className={`${btn({ tone: "primary" })} flex-1`}
        >
          New request
        </Link>
        <Link
          href="/requests/bulk"
          className={`${btn()} flex-1 border-[var(--color-brand-600)] text-[var(--color-brand-700)]`}
        >
          Send to many
        </Link>
      </div>

      {/* Selection lives in the form, not in React state, because DataTable is
          a server component. See components/admin/BulkBar. */}
      <RequestBulkBar showArchived={showArchived}>
        <DataTable
          columns={columns}
          rows={requests}
          rowKey={(request) => request.id}
          href={(request) => `/requests/${request.id}`}
          empty="No requests yet. Create one and you get a link to send on WhatsApp."
          select={{ name: "id", value: (request) => request.id }}
          /* On a phone the row is not seven labelled values, it is one line of
             who it is about, the request, and then everything that changes
             over time as a run of monospace facts the eye can compare down the
             column. The "to review" count is plain text here rather than the
             table's link — the whole card is already a link, and a nested one
             swallows whichever tap lands on it. */
          card={(request) => (
            <>
              <div className="text-xs font-medium text-[var(--color-ink-muted)]">
                {request.audienceLabel}
              </div>
              <div className="mt-0.5 text-base font-medium">
                {request.title}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                <span>{request.teacher}</span>
                <span
                  className={`font-mono ${
                    request.studentsAnswered >= request.rosterSize &&
                    request.rosterSize > 0
                      ? "font-medium text-[var(--color-success)]"
                      : ""
                  }`}
                >
                  {request.studentsAnswered}/{request.rosterSize}
                </span>
                <span
                  className={`font-mono ${
                    request.dueDate < today && request.status === "open"
                      ? "font-medium text-[var(--color-danger)]"
                      : ""
                  }`}
                >
                  due {request.dueDate}
                </span>
                <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono">
                  {request.status}
                </span>
                {request.archivedAt ? (
                  <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono">
                    archived
                  </span>
                ) : null}
                {request.changesPending > 0 ? (
                  <span className="rounded bg-[var(--color-correct-bg)] px-1.5 py-0.5 font-mono font-medium text-[var(--color-correct-fg)]">
                    {request.changesPending} to review
                  </span>
                ) : null}
              </div>
            </>
          )}
        />
      </RequestBulkBar>

      {requests.length > 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          &ldquo;Answered&rdquo; counts students the teacher has responded for on
          every field this request asked about, however she answered. A card
          left with one box empty is not counted. &ldquo;To review&rdquo; counts
          only the answers that differ from what she was sent.
        </p>
      ) : null}
    </div>
  );
}
