import type { BoardBatch, MissingGroup, RequestBoardRow } from "@/lib/requests";
import { isAnsweredFully } from "@/lib/answered";
import { compareClassLabels } from "@/lib/classes";
import { daysUntil } from "@/lib/today";
import {
  buildGroupMissingMessage,
  buildRoundMissingMessage,
  buildRoundStatusMessage,
} from "@/lib/whatsapp";
import { card } from "@/components/ui/controls";
import { ProgressBar } from "./ProgressBar";
import { ShareMessage } from "./ShareMessage";
import { TONE, toneOf } from "./progress-tone";

/**
 * How far a whole round has got, and who is left in it.
 *
 * THE HOLE THIS FILLS. The round's own page could say how many messages had
 * been handed over and nothing whatsoever about what came back: getBatch reads
 * no submissions at all. So a photo round with four hundred and ninety-three of
 * five hundred and thirty-one children done looked exactly like one nobody had
 * started, and the only way to learn otherwise was to open nineteen links or
 * squint at the board.
 *
 * EVERY NUMBER HERE COMES FROM groupBoardRows, WHICH IS THE BOARD'S OWN
 * ARITHMETIC. Nothing on this screen recomputes "answered" — that definition
 * lives in lib/answered.ts and the last thing that formed a second opinion
 * about it was the request_progress view, whose gravestone is still in
 * drizzle/sql/grants.sql. The board line and this header are the same fact at
 * two sizes, and they cannot drift because there is one function.
 *
 * A SERVER COMPONENT. It holds no state and handles no event; the only client
 * code is CopyButton. Building the messages here rather than in the browser
 * costs nothing, because unlike a wa.me href they are never also a URL.
 */
export function RoundProgress({
  round,
  title,
  dueDate,
  today,
  rows,
  missing,
}: {
  /** The batch line, straight out of groupBoardRows. */
  round: BoardBatch;
  title: string;
  dueDate: string;
  today: string;
  /** Every link in the round, for the per-group list. */
  rows: RequestBoardRow[];
  /** Only the groups with someone still outstanding. See listMissingForBatch. */
  missing: MissingGroup[];
}) {
  const remaining = Math.max(0, round.rosterSize - round.studentsAnswered);
  const days = daysUntil(dueDate, today);
  const missingBy = new Map(missing.map((group) => [group.requestId, group]));

  const groups = rows
    .slice()
    .sort((a, b) => compareClassLabels(a.audienceLabel, b.audienceLabel));

  /*
   * The two messages that leave the building.
   *
   * NEITHER CARRIES A LINK, and that is a safety property rather than an
   * omission. Both are built to be pasted into a group, and a request token
   * opens that group's whole roster to anyone holding it — /requests/[id] says
   * so on screen. The per-teacher chase below still sends her own link straight
   * to her own chat, which is where a bearer token belongs.
   */
  const outstanding = groups
    .filter((row) => !isAnsweredFully(row))
    .map((row) => ({
      label: row.audienceLabel,
      answered: row.studentsAnswered,
      rosterSize: row.rosterSize,
    }));

  const statusMessage = buildRoundStatusMessage({
    submitted: round.groupsAnswered,
    total: round.groups,
    outstanding,
    title,
    dueDate,
  });

  const namesMessage = buildRoundMissingMessage({
    title,
    dueDate,
    groups: missing.map((group) => ({
      audience: {
        kind: group.audienceKind,
        label: group.audienceLabel,
        fieldKeys: group.fieldKeys,
      },
      answered: group.answered,
      rosterSize: group.rosterSize,
      students: group.students,
    })),
  });

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <h2 className="text-title font-semibold">
        {round.studentsAnswered} of {round.rosterSize}{" "}
        {round.rosterSize === 1 ? "child" : "children"} answered for
      </h2>

      <ProgressBar
        value={round.studentsAnswered}
        max={round.rosterSize}
        tone={
          remaining === 0
            ? "bg-[var(--color-success)]"
            : days < 0
              ? "bg-[var(--color-danger)]"
              : "bg-[var(--color-warning)]"
        }
        label={`${title} — children answered for`}
        className="mt-2 h-2"
      />

      {/* The words, not only the bar. Somebody reading this on a phone in a
          corridor has to be able to act on it without separating two ambers. */}
      <p className="mt-2 text-body">
        {remaining === 0 ? (
          <span className="font-medium text-[var(--color-success)]">
            Everything is in.
          </span>
        ) : (
          <>
            <span className="font-medium">{remaining} still to go</span>
            <span className="text-[var(--color-ink-muted)]">
              {" "}
              across {missing.length}{" "}
              {missing.length === 1 ? "group" : "groups"}
            </span>
          </>
        )}
      </p>

      <p className="mt-1 font-mono text-meta text-[var(--color-ink-muted)]">
        {round.groupsAnswered} of {round.groups} groups complete ·{" "}
        {round.sentCount} sent
        {round.changesPending > 0 ? ` · ${round.changesPending} to review` : ""}
        {/* Said out loud, because the board's line for this round counts only
            the unarchived children and this page deliberately counts them all —
            see the note in groupBoardRows. Two screens differing is fine; two
            screens differing silently is not. */}
        {round.archivedCount > 0 ? ` · ${round.archivedCount} archived` : ""}
      </p>

      <p className="mt-1 text-label text-[var(--color-ink-muted)]">
        Due {dueDate} —{" "}
        {days < 0 ? (
          <span className="font-medium text-[var(--color-danger)]">
            {Math.abs(days)} {Math.abs(days) === 1 ? "day" : "days"} overdue
          </span>
        ) : days === 0 ? (
          <span className="font-medium text-[var(--color-warning-fg)]">
            due today
          </span>
        ) : (
          `${days} ${days === 1 ? "day" : "days"} left`
        )}
      </p>

      {missing.length > 0 ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-label font-medium">
            Post it where everyone will see it
          </h3>
          <ShareMessage
            title="The round, in numbers"
            hint="Which groups are still short, and how far each has got."
            message={statusMessage}
            note="Names groups, not teachers, and carries no link — safe for the staff group."
            copyLabel="Copy the summary"
            tone="go"
          />
          <ShareMessage
            title="Every child still to come"
            hint="The same thing, with the children named."
            message={namesMessage}
            note="This names children. Send it to the class teachers, not to a school-wide group. It carries names and roll numbers only — no link, no phone number, nothing else."
            copyLabel="Copy every name"
          />
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-label font-medium">Group by group</h3>
        <ul className="mt-2 divide-y divide-[var(--color-border)]">
          {groups.map((row) => {
            const left = missingBy.get(row.id);
            const done = isAnsweredFully(row);
            const tone =
              TONE[
                toneOf({
                  done,
                  sent: row.sentAt !== null,
                  opened: row.openedAt !== null,
                  overdue: row.dueDate < today && !done,
                  answered: row.studentsAnswered,
                })
              ];

            return (
              <li key={row.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {row.audienceLabel}
                  </span>
                  <span
                    className={`rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                  >
                    {tone.label}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {row.teacher}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar
                    value={row.studentsAnswered}
                    max={row.rosterSize}
                    tone={tone.bar}
                    label={`${row.audienceLabel} — ${title}`}
                    className="h-1.5 min-w-16 flex-1 sm:w-32 sm:flex-none"
                  />
                  <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                    {row.studentsAnswered} of {row.rosterSize}
                  </span>
                </div>

                {/* The list that actually produces photographs: which six
                    children she has left, by roll number and name, ready to
                    paste to her or into her class group. */}
                {left ? (
                  <div className="mt-2">
                    <ShareMessage
                      title={`${left.students.length} still to come in ${left.audienceLabel}`}
                      hint={`For ${left.teacherName}, or the class group.`}
                      message={buildGroupMissingMessage({
                        audience: {
                          kind: left.audienceKind,
                          label: left.audienceLabel,
                          fieldKeys: left.fieldKeys,
                        },
                        title,
                        dueDate,
                        answered: left.answered,
                        rosterSize: left.rosterSize,
                        students: left.students,
                      })}
                      copyLabel="Copy the names"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
