import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { getBatch } from "@/lib/batches";
import { groupLinksByRecipient } from "@/lib/send-queue";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RequestBulkBar } from "../../RequestBulkBar";
import { SendQueue } from "./SendQueue";

export const metadata = { title: "Send queue — Sampark" };
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

  const host = (await headers()).get("host") ?? "";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const { batch, links } = detail;

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
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            {batch.title}
          </h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {groups.length} {groups.length === 1 ? "message" : "messages"} ·{" "}
          {links.length} {links.length === 1 ? "link" : "links"} · due{" "}
          {batch.dueDate}
        </p>
      </header>

      <SendQueue
        batchId={batch.id}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        groups={groups}
      />

      {/* The other half of a round's life. Sending it happens above; clearing
          it away once every class has answered used to mean going back to the
          board and ticking the same nineteen rows again, which is why finished
          rounds sit there for months. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-title font-semibold">Clear this round</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
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
