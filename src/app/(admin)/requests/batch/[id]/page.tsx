import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  canCreateRequests,
  canManageSettings,
  currentUser,
} from "@/lib/auth/session";
import { requestOrigin } from "@/lib/request-origin";
import { findMasterLink, getBatch } from "@/lib/batches";
import { getOfficeRecipient } from "@/lib/office";
import { MasterLinkCard } from "./MasterLinkCard";
import {
  groupBoardRows,
  listRequests,
  pendingForBoard,
  type BoardBatch,
} from "@/lib/requests";
import { isAnsweredFully } from "@/lib/answered";
import { compareClassLabels } from "@/lib/classes";
import {
  buildRoundPendingMessage,
  buildRoundStatusMessage,
} from "@/lib/whatsapp";
import { RoundProgress } from "@/components/admin/RoundProgress";
import { RoundShare } from "./RoundShare";
import { groupRemindersByTeacher } from "@/lib/reminders";
import { groupLinksByRecipient, toQueueLinks } from "@/lib/send-queue";
import { isApiConfigured } from "@/lib/aisensy";
import { latestApiSends } from "@/lib/whatsapp-log";
import { daysUntil, todayISO } from "@/lib/today";
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

  // The round's own link and the number it goes to. Both may be absent — a
  // subject round never has one, and neither does a round created before
  // anybody set an office number. The card says which, and offers the fix.
  const [master, office] = await Promise.all([
    findMasterLink(batch.id),
    getOfficeRecipient(),
  ]);

  /*
   * Who in this round still owes something.
   *
   * listRequests is the board's own query, so these numbers are the board's
   * numbers — and groupRemindersByTeacher then collapses a teacher's several
   * groups into one nudge, exactly as the dashboard does. A teacher taking
   * maths for three classes in this round gets one message, not three.
   */
  const today = todayISO();
  const boardRows = await listRequests({ batchId: batch.id });
  // ONE pending read, two uses: the chase list below names what each teacher
  // owes, and the round's copy block names the same children to a room. A
  // second query would be a second chance to disagree about who is missing.
  const pending = await pendingForBoard(boardRows);
  const outstanding = groupRemindersByTeacher(boardRows, today, pending);

  /*
   * The round, as one line — the board's own arithmetic, not a second sum.
   *
   * `round` is absent only for a fan-out that failed before creating a single
   * link, which is a real state: runGroups keeps what it made, and the "Finish
   * the batch" control inside SendQueue is what repairs it.
   */
  const round = groupBoardRows(boardRows, new Map([[batch.id, batch]])).find(
    (entry): entry is BoardBatch => entry.kind === "batch",
  );

  const short = boardRows
    .slice()
    .filter((row) => !isAnsweredFully(row))
    .sort((a, b) => compareClassLabels(a.audienceLabel, b.audienceLabel));

  const statusMessage = round
    ? buildRoundStatusMessage({
        submitted: round.groupsAnswered,
        total: round.groups,
        outstanding: short.map((row) => ({
          label: row.audienceLabel,
          answered: row.studentsAnswered,
          rosterSize: row.rosterSize,
        })),
        title: batch.title,
        dueDate: batch.dueDate,
      })
    : null;

  const pendingMessage =
    short.length > 0
      ? buildRoundPendingMessage({
          title: batch.title,
          dueDate: batch.dueDate,
          groups: short.map((row) => ({
            label: row.audienceLabel,
            answered: row.studentsAnswered,
            rosterSize: row.rosterSize,
            pending: pending.get(row.id) ?? null,
          })),
        })
      : null;

  // Grouped HERE, on the server. groupLinksByRecipient is db-free so it could
  // run in the browser, but there is no reason to ship the whole link list to
  // do work the server already has the data for. toQueueLinks is the same
  // mapping the API send uses to rebuild a card — see lib/send-queue.ts.
  const groups = groupLinksByRecipient(toQueueLinks(links));

  // When each link last went out through the API, for the card's "sent via
  // WhatsApp · 10:42" line. ISO strings, because this crosses to a client
  // component.
  const apiEnabled = isApiConfigured();
  const apiSentAt = Object.fromEntries(
    [...(await latestApiSends(links.map((link) => link.requestId)))].map(
      ([requestId, send]) => [requestId, send.at.toISOString()],
    ),
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
            {batch.dueDate} — <DueIn dueDate={batch.dueDate} today={today} />
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

      {round ? (
        <RoundProgress
          round={round}
          title={batch.title}
          rows={boardRows}
          today={today}
          share={
            statusMessage ? (
              <RoundShare status={statusMessage} pending={pendingMessage} />
            ) : null
          }
        />
      ) : null}

      {/* Above the queue, because it is the alternative to working through it:
          one link over every class, for the office to finish what is left. */}
      <MasterLinkCard
        batchId={batch.id}
        master={
          master
            ? {
                token: master.token,
                rosterSize: master.rosterSize,
                // Formatted on the server: a Date crossing into a client
                // component renders differently in the two passes and trips
                // hydration. The same reason every other date here is a string.
                sentAt: master.sentAt
                  ? master.sentAt.toISOString().slice(0, 10)
                  : null,
              }
            : null
        }
        officeName={office?.name ?? "Office"}
        officePhone={office?.phone ?? null}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        apiEnabled={apiEnabled}
        canRotate={canManageSettings(session.role)}
      />

      <SendQueue
        batchId={batch.id}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        groups={groups}
        apiEnabled={apiEnabled}
        apiSentAt={apiSentAt}
      />

      <RoundNudge
        teachers={outstanding}
        origin={origin}
        batchId={batch.id}
        today={today}
        apiEnabled={apiEnabled}
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

/**
 * How long is left, in words rather than in a date.
 *
 * "due 2026-08-21" asks the office to work out what that means today, on a
 * phone, in a corridor. The date stays — it is the thing the teacher was told —
 * and this says what it costs.
 *
 * The COLOUR IS NEVER THE ONLY CARRIER, the same rule the tone chips follow:
 * "18 days overdue" reads the same to somebody who cannot separate the red.
 */
function DueIn({ dueDate, today }: { dueDate: string; today: string }) {
  const days = daysUntil(dueDate, today);
  if (days < 0) {
    return (
      <span className="font-medium text-[var(--color-danger)]">
        {Math.abs(days)} {Math.abs(days) === 1 ? "day" : "days"} overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="font-medium text-[var(--color-warning-fg)]">
        due today
      </span>
    );
  }
  return (
    <span>
      {days} {days === 1 ? "day" : "days"} left
    </span>
  );
}
