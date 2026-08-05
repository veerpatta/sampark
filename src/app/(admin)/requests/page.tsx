import Link from "next/link";
import { listRequests } from "@/lib/requests";

export const metadata = { title: "Requests — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The status board.
 *
 * This screen is the enforcement mechanism (plan section 10): "8 of 11 classes
 * submitted" shared in the staff group does more than ten reminder messages.
 * The answered and pending columns stay at zero until Phase 3 writes
 * submissions, so they are left off rather than shown as a real-looking zero.
 */
export default async function RequestsPage() {
  const requests = await listRequests();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {requests.length} request{requests.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/requests/new"
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
        >
          New request
        </Link>
      </header>

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {requests.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-muted)]">
            No requests yet. Create one and you get a link to send on WhatsApp.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Answered</th>
                <th className="px-4 py-3">To review</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)]"
                >
                  <td className="px-4 py-2 font-medium">{request.classLabel}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/requests/${request.id}`}
                      className="font-medium text-[var(--color-brand-600)] hover:underline"
                    >
                      {request.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--color-ink-muted)]">
                    {request.teacher}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <span
                      className={
                        request.studentsAnswered >= request.rosterSize &&
                        request.rosterSize > 0
                          ? "font-medium text-[var(--color-success)]"
                          : ""
                      }
                    >
                      {request.studentsAnswered} / {request.rosterSize}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {request.changesPending > 0 ? (
                      <Link
                        href={`/review?request=${request.id}`}
                        className="rounded bg-[var(--color-correct-bg)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-correct-fg)] hover:underline"
                      >
                        {request.changesPending}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        request.dueDate < today && request.status === "open"
                          ? "font-medium text-[var(--color-danger)]"
                          : ""
                      }
                    >
                      {request.dueDate}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
                      {request.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
