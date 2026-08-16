import Link from "next/link";
import {
  listRequestBoard,
  listRequests,
  type BoardEntry,
} from "@/lib/requests";
import { isAnsweredFully } from "@/lib/answered";
import { groupProgressByTeacher } from "@/lib/progress";
import { marksFieldKeys } from "@/lib/marks";
import { requestOrigin } from "@/lib/request-origin";
import { todayISO } from "@/lib/today";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader } from "@/components/admin/PageHeader";
import { TeacherProgressList } from "@/components/admin/TeacherProgressList";
import { btn, card, chip } from "@/components/ui/controls";
import { RequestBulkBar } from "./RequestBulkBar";

export const metadata = { title: "Requests — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Every request, and how far each has got.
 *
 * A SEND-TO-MANY ROUND IS ONE LINE, not nineteen. It used to be nineteen
 * anonymous rows interleaved with everything else, with nothing on them saying
 * they were one thing — and the send queue that knows they are was reachable
 * only by the redirect immediately after the send, so navigating away lost it.
 * The round's line is now the way back.
 *
 * Every number on a round's line is a sum over exactly the children the current
 * filter shows. See groupBoardRows for why that is the only self-consistent
 * rule, and what it means for an archived child.
 *
 * A table at md and up, a stack of cards below it — a seven-column table on a
 * 390px phone puts the two columns that matter (answered, to review) off the
 * right edge. See components/admin/DataTable.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; view?: string }>;
}) {
  const params = await searchParams;
  // Archived rows are reachable but never the default. An archive nobody can
  // open is a delete with extra steps, and the whole reason answered requests
  // are archived rather than deleted is that their contents still matter.
  const showArchived = params.archived === "1";
  /*
   * BY TEACHER IS THE DEFAULT, and anything unrecognised falls back to it.
   *
   * The office's question after a round is "how far has each teacher got",
   * and for as long as this board was one row per link there was nowhere to
   * ask it — a teacher holding three links was three rows that each knew only
   * about themselves. The round view is still here and still owns closing,
   * archiving and bulk work; it is simply no longer what opens.
   */
  const view = params.view === "rounds" ? "rounds" : "teachers";
  // The school's calendar date, not the server's. See lib/today.ts.
  const today = todayISO();

  if (view === "teachers") {
    return <ByTeacher today={today} />;
  }

  const entries = await listRequestBoard({ includeArchived: showArchived });

  const links = entries.reduce(
    (total, entry) => total + (entry.kind === "batch" ? entry.groups : 1),
    0,
  );

  /** Both kinds carry these, so the shared cells do not have to branch. */
  const dueDate = (entry: BoardEntry) => entry.dueDate;
  const status = (entry: BoardEntry) => entry.status;
  const answered = (entry: BoardEntry) => entry.studentsAnswered;
  const roster = (entry: BoardEntry) => entry.rosterSize;
  const pending = (entry: BoardEntry) => entry.changesPending;
  const complete = (entry: BoardEntry) => isAnsweredFully(entry);

  const columns: Column<BoardEntry>[] = [
    {
      key: "class",
      header: "Class",
      role: "secondary",
      cell: (entry) =>
        entry.kind === "batch"
          ? `${entry.groups} group${entry.groups === 1 ? "" : "s"}${
              // Only worth saying when it is not one teacher per group, which
              // is the subject round: sixteen links across five teachers.
              entry.teachers < entry.groups ? ` · ${entry.teachers} teachers` : ""
            }`
          : entry.audienceLabel,
      cellClassName: "font-medium",
    },
    {
      key: "title",
      header: "Request",
      role: "primary",
      // Plain text: DataTable wraps the primary cell in the row's link itself.
      cell: (entry) => entry.title,
    },
    {
      key: "teacher",
      header: "Teacher",
      // A round has no single teacher, so it names the groups instead — the one
      // thing collapsing costs you is being able to eyeball "Class 8" on the
      // board, and this is what buys it back.
      cell: (entry) =>
        entry.kind === "batch" ? describeGroups(entry) : entry.teacher,
      cellClassName: "text-[var(--color-ink-muted)]",
    },
    {
      key: "answered",
      header: "Answered",
      cell: (entry) => (
        <span className="flex flex-col">
          <span
            className={`font-mono text-xs ${
              complete(entry) ? "font-medium text-[var(--color-success)]" : ""
            }`}
          >
            {answered(entry)} / {roster(entry)}
          </span>
          {/* After a round the office's question is "how many classes are
              done", not "how many children" — and neither screen could answer
              it before. */}
          {entry.kind === "batch" ? (
            <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">
              {entry.groupsAnswered}/{entry.groups} groups
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "review",
      header: "To review",
      // Holds a link of its own, so it stays off the card — where the card IS
      // the link and a second one inside it cannot be tapped.
      hideOnCard: true,
      cell: (entry) =>
        pending(entry) === 0 ? (
          <span className="font-mono text-xs text-[var(--color-ink-muted)]">—</span>
        ) : entry.kind === "batch" ? (
          // Plain text: /review?request= takes ONE request, and a round is
          // several. Opening the round and picking one is the honest path.
          <span className="rounded bg-[var(--color-correct-bg)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-correct-fg)]">
            {entry.changesPending}
          </span>
        ) : (
          <Link
            href={`/review?request=${entry.id}`}
            className="rounded bg-[var(--color-correct-bg)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-correct-fg)] hover:underline"
          >
            {entry.changesPending}
          </Link>
        ),
    },
    {
      key: "due",
      header: "Due",
      cell: (entry) => (
        <span
          className={
            dueDate(entry) < today && status(entry) === "open"
              ? "font-medium text-[var(--color-danger)]"
              : ""
          }
        >
          {dueDate(entry)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (entry) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
            {status(entry)}
          </span>
          {/* A round whose groups disagree says how they disagree rather than
              picking a side. */}
          {entry.kind === "batch" &&
          entry.closedCount > 0 &&
          entry.closedCount < entry.groups ? (
            <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
              {entry.closedCount}/{entry.groups} closed
            </span>
          ) : null}
          {archivedChip(entry)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Requests"
        subtitle={`${entries.length} on the board · ${links} link${
          links === 1 ? "" : "s"
        }${showArchived ? ", archived included" : ""}`}
        actions={
          <Link
            // Carries the view, or the toggle would bounce you back to the
            // teacher board every time you asked to see archived rows.
            href={
              showArchived ? "/requests?view=rounds" : "/requests?view=rounds&archived=1"
            }
            className={`${btn()} text-[var(--color-ink-muted)]`}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        }
      />

      <ViewToggle current="rounds" />

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
          rows={entries}
          rowKey={(entry) => (entry.kind === "batch" ? entry.batchId : entry.id)}
          href={(entry) =>
            entry.kind === "batch"
              ? `/requests/batch/${entry.batchId}`
              : `/requests/${entry.id}`
          }
          empty="No requests yet. Create one and you get a link to send on WhatsApp."
          /* ONE TICK, EVERY LINK IN THE ROUND. A round's value is its children
             joined by a comma, which BulkBar expands before it calls anything —
             the actions have always spoken flat request ids. */
          select={{
            name: "id",
            value: (entry) =>
              entry.kind === "batch" ? entry.requestIds.join(",") : entry.id,
          }}
          /* On a phone the row is not seven labelled values, it is one line of
             who it is about, the request, and then everything that changes
             over time as a run of monospace facts the eye can compare down the
             column. The "to review" count is plain text here rather than the
             table's link — the whole card is already a link, and a nested one
             swallows whichever tap lands on it. */
          card={(entry) => (
            <>
              <div className="text-xs font-medium text-[var(--color-ink-muted)]">
                {entry.kind === "batch"
                  ? `${entry.groups} group${entry.groups === 1 ? "" : "s"}`
                  : entry.audienceLabel}
              </div>
              <div className="mt-0.5 text-base font-medium">{entry.title}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                <span>
                  {entry.kind === "batch" ? describeGroups(entry) : entry.teacher}
                </span>
                <span
                  className={`font-mono ${
                    complete(entry) ? "font-medium text-[var(--color-success)]" : ""
                  }`}
                >
                  {answered(entry)}/{roster(entry)}
                </span>
                <span
                  className={`font-mono ${
                    dueDate(entry) < today && status(entry) === "open"
                      ? "font-medium text-[var(--color-danger)]"
                      : ""
                  }`}
                >
                  due {dueDate(entry)}
                </span>
                <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono">
                  {status(entry)}
                </span>
                {entry.kind === "batch" && entry.sentCount < entry.groups ? (
                  <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono">
                    {entry.sentCount}/{entry.groups} sent
                  </span>
                ) : null}
                {archivedChip(entry)}
                {pending(entry) > 0 ? (
                  <span className="rounded bg-[var(--color-correct-bg)] px-1.5 py-0.5 font-mono font-medium text-[var(--color-correct-fg)]">
                    {pending(entry)} to review
                  </span>
                ) : null}
              </div>
            </>
          )}
        />
      </RequestBulkBar>

      {entries.length > 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          &ldquo;Answered&rdquo; counts students the teacher has responded for on
          every field this request asked about, however she answered. A card
          left with one box empty is not counted. &ldquo;To review&rdquo; counts
          only the answers that differ from what she was sent. A round&rsquo;s
          figures cover the links shown here — open it to see every group,
          including any that have been archived.
        </p>
      ) : null}
    </div>
  );
}

/**
 * How far each teacher has got — what this tab opens on.
 *
 * ONE ROW PER PERSON, TWO COUNTS. Marks and student details are different work,
 * chased differently and finished at different times, so they stay two figures
 * rather than being averaged into one that describes neither. A teacher holding
 * no marks rounds simply has no marks count.
 *
 * The list itself is TeacherProgressList, shared with the dashboard, because
 * "who is behind" answered two ways in two places is a disagreement waiting to
 * be found by whoever has both tabs open.
 */
async function ByTeacher({ today }: { today: string }) {
  const [requests, origin, marksKeys] = await Promise.all([
    listRequests(),
    requestOrigin(),
    marksFieldKeys(),
  ]);

  const open = requests.filter((request) => request.status === "open");
  const teachers = groupProgressByTeacher(
    open,
    new Set(marksKeys.keys()),
    today,
  );

  const outstanding = teachers.reduce(
    (total, teacher) => total + teacher.outstanding,
    0,
  );
  const behind = teachers.filter((teacher) => teacher.overdue).length;

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Requests"
        subtitle={
          teachers.length === 0
            ? "Nothing is open."
            : `${teachers.length} teacher${teachers.length === 1 ? "" : "s"} · ${outstanding} child${
                outstanding === 1 ? "" : "ren"
              } still to answer for${behind > 0 ? ` · ${behind} past due` : ""}`
        }
      />

      <div className="flex gap-2">
        <Link href="/requests/new" className={`${btn({ tone: "primary" })} flex-1`}>
          New request
        </Link>
        <Link
          href="/requests/bulk"
          className={`${btn()} flex-1 border-[var(--color-brand-600)] text-[var(--color-brand-700)]`}
        >
          Send to many
        </Link>
      </div>

      <ViewToggle current="teachers" />

      <section className={`${card()} p-4 md:p-6`}>
        <TeacherProgressList
          teachers={teachers}
          origin={origin}
          empty="Nothing is open. Create a request and it will show up here as answers arrive."
        />
      </section>

      {teachers.length > 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          A teacher counts as done for a list when every child on its frozen
          roster has been answered for on every field it asked about — however
          she answered. A card left with one box empty is not counted.
          &ldquo;Not sent&rdquo; means the office never handed that link over,
          which is not the same as her not having started.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Two views of the same work.
 *
 * Links styled as chips rather than a select or a FilterBar: FilterBar is a GET
 * form for narrowing a list, and these two are mutually exclusive destinations —
 * that is navigation. It is also how /marks picks a period, and for the same
 * reason given there: "a select on a phone is a modal wheel for what is one
 * tap". Works with JavaScript off either way.
 */
function ViewToggle({ current }: { current: "teachers" | "rounds" }) {
  const views = [
    { key: "teachers" as const, href: "/requests", label: "By teacher" },
    { key: "rounds" as const, href: "/requests?view=rounds", label: "By round" },
  ];

  return (
    <nav aria-label="View" className="flex flex-wrap gap-2">
      {views.map((view) => (
        <Link
          key={view.key}
          href={view.href}
          aria-current={view.key === current ? "page" : undefined}
          className={chip({ on: view.key === current, pill: true })}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Class 6, Class 7, Class 8 +16 more" */
function describeGroups(entry: Extract<BoardEntry, { kind: "batch" }>): string {
  const rest = entry.groups - entry.sample.length;
  return `${entry.sample.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`;
}

function archivedChip(entry: BoardEntry) {
  const chip = (text: string) => (
    <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
      {text}
    </span>
  );

  if (entry.kind === "single") return entry.archivedAt ? chip("archived") : null;
  if (entry.archivedCount === 0) return null;
  // The whole round is off the boards, or only part of it is.
  return chip(
    entry.archivedCount === entry.groups
      ? "archived"
      : `${entry.archivedCount} archived`,
  );
}
