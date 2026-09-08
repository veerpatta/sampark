import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/request-origin";
import { getBatch } from "@/lib/batches";
import {
  groupBoardRows,
  listMissingForBatch,
  listRequests,
  type BoardBatch,
} from "@/lib/requests";
import { groupRemindersByTeacher } from "@/lib/reminders";
import { groupLinksByRecipient } from "@/lib/send-queue";
import { todayISO } from "@/lib/today";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RequestBulkBar } from "../../RequestBulkBar";
import { btn } from "@/components/ui/controls";
import { RoundProgress } from "@/components/admin/RoundProgress";
import { SendQueue } from "./SendQueue";
import { ChaseQueue } from "./ChaseQueue";

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

  const { batch, links } = detail;
  const today = todayISO();

  /*
   * ONE QUERY, THREE USES. listRequests is the board's own query, so every
   * number on this page is the board's number arrived at by the board's
   * arithmetic — the progress header, the chase list and the per-group rows
   * cannot disagree with each other or with /requests, because there is one
   * source and one definition of "answered" (lib/answered.ts).
   *
   * `includeArchived` is on deliberately. groupBoardRows' own header says the
   * board line is a view over the rows it was given and that "the round's own
   * page always lists all nineteen" — this is that page. Where the two differ,
   * the header says so out loud rather than letting somebody discover it.
   */
  const [rows, missing, origin] = await Promise.all([
    listRequests({ batchId: batch.id, includeArchived: true }),
    listMissingForBatch(batch.id),
    requestOrigin(),
  ]);

  const round = groupBoardRows(rows, new Map([[batch.id, batch]])).find(
    (entry): entry is BoardBatch => entry.kind === "batch",
  );

  /*
   * Who in this round still owes something.
   *
   * The UNARCHIVED rows, unlike the header above: an archived group is one the
   * office has swept off the boards, and chasing a teacher for work that has
   * been written off is the one thing this list must not do.
   * groupRemindersByTeacher then collapses her several groups into one nudge,
   * exactly as the dashboard does — a teacher taking maths for three classes in
   * this round gets one message, not three.
   */
  const outstanding = groupRemindersByTeacher(
    rows.filter((row) => row.archivedAt === null),
    today,
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

      {/* How far the round has got, and who is left in it. Above the send
          queue because after the first day this is the question — the queue is
          a one-off act, the progress is what somebody comes back for.
          `round` is absent only for a fan-out that failed before creating a
          single link, which is a real state: runGroups keeps what it made and
          the "Finish the batch" control inside SendQueue is what fixes it. */}
      {round ? (
        <RoundProgress
          round={round}
          title={batch.title}
          dueDate={batch.dueDate}
          today={today}
          rows={rows}
          missing={missing}
        />
      ) : null}

      <SendQueue
        batchId={batch.id}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        groups={groups}
      />

      <ChaseQueue
        batchId={batch.id}
        teachers={outstanding}
        origin={origin}
        today={today}
      />

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
            columns={cleanupColumns(
              new Map(rows.map((row) => [row.id, row.studentsAnswered])),
            )}
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

/**
 * Built from the board's counts rather than from getBatch.
 *
 * getBatch reads no submissions at all — it exists for the send queue and this
 * cleanup table — and giving it answered counts would put a second computation
 * of "answered" one function away from coveredStudentsQuery. That is precisely
 * what the request_progress view did before it was dropped; the gravestone is
 * in drizzle/sql/grants.sql. The page already holds the board's numbers, so the
 * column takes them as a map.
 */
const cleanupColumns = (
  answeredBy: ReadonlyMap<string, number>,
): Column<BatchLink>[] => [
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
    key: "answered",
    header: "Answered",
    cell: (link) =>
      `${answeredBy.get(link.requestId) ?? 0} of ${link.rosterSize}`,
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
