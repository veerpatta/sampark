import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/request-origin";
import { getBatch } from "@/lib/batches";
import { listRequests } from "@/lib/requests";
import { groupRemindersByTeacher } from "@/lib/reminders";
import { groupLinksByRecipient } from "@/lib/send-queue";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RequestBulkBar } from "../../RequestBulkBar";
import { btn } from "@/components/ui/controls";
import { SendQueue } from "./SendQueue";
import { RoundNudge } from "./RoundNudge";

// The round's home, not just the screen you land on after sending — the board
// links here now, so this is where a round is looked at afterwards too.
export const metadata = { title: "Round — Sampark" };
export const dynamic = "force-dynamic";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await currentUser();
  if (!session || !canCreateRequests(session.role)) redirect("/");

  const { id } = await params;
  const detail = await getBatch(id);
  if (!detail) notFound();

  const origin = await requestOrigin();

  const { batch, links } = detail;

  /*
   * Who in this round still owes something.
   *
   * listRequests is the board's own query, so these numbers are the board's
   * numbers — and groupRemindersByTeacher then collapses a teacher's several
   * groups into one nudge, exactly as the dashboard does. A teacher taking
   * maths for three classes in this round gets one message, not three.
   */
  const outstanding = groupRemindersByTeacher(
    await listRequests({ batchId: batch.id }),
    new Date().toISOString().slice(0, 10),
  );

  // Grouped HERE, on the server. groupLinksByRecipient is db-free so it could
  // run in the browser, but there is no reason to ship the whole link list to
  // do work the server already has the data for.
  const groups = groupLinksByRecipient(
    links.map((link) => ({
      requestId: link.requestId,
      token: link.token,
      audienceKind: link.audienceKind,
      audienceLabel: link.audienceLabel,
      fieldKeys: link.fieldKeys,
      classLabels: link.classLabels,
      teacherId: link.teacherId,
      teacherName: link.teacherName,
      teacherPhone: link.teacherPhone,
      contactPhone: link.contactPhone,
      teacherLinkToken: link.teacherLinkToken,
      rosterSize: link.rosterSize,
      sent: link.sentAt !== null,
    })),
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <h1 className="text-display font-semibold">
              {batch.title}
            </h1>
            <Link
              href="/requests"
              className="text-sm text-[var(--color-brand-600)] hover:underline"
            >
              back to the board
            </Link>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {groups.length} {groups.length === 1 ? "message" : "messages"} ·{" "}
            {links.length} {links.length === 1 ? "link" : "links"} · due{" "}
            {batch.dueDate}
          </p>
        </div>

        {/* The whole round as one file, up here and not beside "Clear this
            round" — a download sitting next to "Archive or delete" is one
            misread away from the wrong button. */}
        <a
          href={`/api/export/batch/${batch.id}.xlsx`}
          className={`${btn()} shrink-0`}
        >
          Download this round (.xlsx)
        </a>
      </header>

      <SendQueue
        batchId={batch.id}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        groups={groups}
      />

      <RoundNudge teachers={outstanding} origin={origin} />

      {/* The other half of a round's life. Sending it happens above; clearing
          it away once every class has answered used to mean going back to the
          board and ticking the same nineteen rows again, which is why finished
          rounds sit there for months. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-title font-semibold">Clear this round</h2>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Close the links that are done, then archive them. Anything that
            collected answers keeps them — only the row leaves the boards.
          </p>
        </div>

        <RequestBulkBar showArchived>
          <DataTable
            columns={cleanupColumns}
            rows={links}
            rowKey={(link) => link.requestId}
            href={(link) => `/requests/${link.requestId}`}
            select={{ name: "id", value: (link) => link.requestId }}
            empty="This round has no links."
          />
        </RequestBulkBar>
      </section>
    </div>
  );
}

type BatchLink = NonNullable<Awaited<ReturnType<typeof getBatch>>>["links"][number];

const cleanupColumns: Column<BatchLink>[] = [
  {
    key: "group",
    header: "Group",
    role: "primary",
    cell: (link) => link.audienceLabel,
  },
  {
    key: "teacher",
    header: "Teacher",
    role: "secondary",
    cell: (link) => link.teacherName,
  },
  {
    key: "roster",
    header: "Children",
    cell: (link) => link.rosterSize,
    cellClassName: "font-mono text-xs",
  },
  {
    key: "sent",
    header: "Sent",
    cell: (link) =>
      link.sentAt ? (
        <span className="text-[var(--color-success)]">yes</span>
      ) : (
        <span className="text-[var(--color-ink-muted)]">not yet</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (link) => (
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
          {link.status}
        </span>
        {link.archivedAt ? (
          <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
            archived
          </span>
        ) : null}
      </span>
    ),
  },
];
