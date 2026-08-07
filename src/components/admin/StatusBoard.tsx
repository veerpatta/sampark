"use client";

import Link from "next/link";
import type { RequestBoardRow } from "@/lib/requests";
import {
  buildReminderMessage,
  buildWhatsAppLink,
} from "@/lib/whatsapp";
import { useToast } from "@/components/ui/Toast";
import { shareOrWhatsApp } from "@/components/ui/share";

/**
 * "8 of 11 classes submitted", readable at a glance on a phone.
 *
 * This is the screen the office checks most, and the one that does the actual
 * enforcing — the number shared in the staff group is worth more than ten
 * individual reminders.
 *
 * SUBMITTED IS DERIVED, NOT READ. `requests.status` only ever holds open or
 * closed; nothing in the codebase writes "submitted", so trusting that column
 * would render "0 of 11" forever. A class has submitted when every student on
 * its frozen roster has been answered for.
 *
 * The ones that have NOT submitted come first, overdue first within that,
 * because those are the rows that need a person to do something. Each carries
 * its own reminder button so nudging a teacher is one tap and no navigation.
 *
 * EVERY ROW SAYS ITS STATE IN A WORD as well as a colour. This screen gets read
 * on a phone in a corridor between periods, and a office worker who cannot
 * separate the amber from the red still has to know which teacher to chase.
 */

type Tone = "waiting" | "progress" | "overdue" | "done";

const TONE: Record<Tone, { label: string; pill: string; bar: string; rail: string }> = {
  waiting: {
    label: "not started",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    bar: "bg-[var(--color-border)]",
    rail: "border-l-[var(--color-border)]",
  },
  progress: {
    label: "in progress",
    pill: "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]",
    bar: "bg-[var(--color-warning)]",
    rail: "border-l-[var(--color-warning)]",
  },
  overdue: {
    label: "overdue",
    pill: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
    bar: "bg-[var(--color-danger)]",
    rail: "border-l-[var(--color-danger)]",
  },
  done: {
    label: "complete",
    pill: "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]",
    bar: "bg-[var(--color-success)]",
    rail: "border-l-[var(--color-success)]",
  },
};
export function StatusBoard({ requests }: { requests: RequestBoardRow[] }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  // One row per group: the newest open request for it. Keyed by kind as well as
  // label, because a house and a class could in principle share a name and they
  // are not the same collection.
  const newestPerGroup = new Map<string, RequestBoardRow>();
  for (const request of requests) {
    if (request.status !== "open") continue;
    const key = `${request.audienceKind}|${request.audienceLabel}`;
    if (!newestPerGroup.has(key)) newestPerGroup.set(key, request);
  }
  const open = [...newestPerGroup.values()];
  if (open.length === 0) return null;

  // studentsAnswered now means "answered for every field asked about" — see
  // coveredStudentsQuery in lib/requests.ts. This predicate did not have to
  // change when a half-filled card stopped counting, which is the reason that
  // definition lives in the query rather than in each reader.
  const done = (request: RequestBoardRow) =>
    request.rosterSize > 0 && request.studentsAnswered >= request.rosterSize;

  // Overdue outranks in-progress: it is the row that needs a person to do
  // something today, and how far along it is does not change that.
  const toneOf = (request: RequestBoardRow): Tone =>
    done(request)
      ? "done"
      : request.dueDate < today
        ? "overdue"
        : request.studentsAnswered > 0
          ? "progress"
          : "waiting";

  const submitted = open.filter(done);
  const waiting = open
    .filter((request) => !done(request))
    .sort((a, b) => {
      const aLate = a.dueDate < today ? 0 : 1;
      const bLate = b.dueDate < today ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;
      return a.studentsAnswered / (a.rosterSize || 1) -
        b.studentsAnswered / (b.rosterSize || 1);
    });

  async function remind(request: RequestBoardRow) {
    const url = `${window.location.origin}/r/${request.token}`;
    const message = buildReminderMessage({
      teacherName: request.teacher,
      audience: {
        kind: request.audienceKind,
        label: request.audienceLabel,
        fieldKeys: request.fieldKeys,
      },
      title: request.title,
      dueDate: request.dueDate,
      url,
    });
    const outcome = await shareOrWhatsApp({
      message,
      waUrl: buildWhatsAppLink(request.teacherPhone, message),
    });
    if (outcome === "shared") {
      toast({ message: `Reminded ${request.teacher}.`, tone: "success" });
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
      <h2 className="text-xl font-semibold tracking-tight">
        {submitted.length} of {open.length}{" "}
        {open.length === 1 ? "group has" : "groups have"} submitted
      </h2>

      {waiting.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {waiting.map((request) => {
            const tone = TONE[toneOf(request)];
            const percent =
              request.rosterSize === 0
                ? 0
                : Math.round(
                    (request.studentsAnswered / request.rosterSize) * 100,
                  );
            return (
              <li
                key={request.id}
                className={`flex items-center gap-3 border-l-[4px] py-3 pl-3 first:pt-0 ${tone.rail}`}
              >
                {/* The whole block is the target. It was a bare inline link
                    about twenty pixels tall, with the teacher's name, the
                    status and the bar all sitting outside it and doing
                    nothing. Nothing inside is interactive, so there is no
                    nested-anchor problem. */}
                <Link
                  href={`/requests/${request.id}`}
                  className="block min-w-0 flex-1 py-1 hover:text-[var(--color-brand-600)]"
                >
                  <span className="font-medium">{request.audienceLabel}</span>
                  <span className="ml-2 text-sm text-[var(--color-ink-muted)]">
                    {request.teacher}
                  </span>
                  {/* The word, next to the teacher whose row it is. This is what
                      makes the colour redundant rather than load-bearing, and
                      it folds in the standalone "overdue" label that used to
                      sit apart from everything else that said the same. */}
                  <span
                    className={`ml-2 rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                  >
                    {tone.label}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-muted)] sm:w-24 sm:flex-none">
                      {/* Takes the row's tone, not a fixed green. A green bar
                          sitting at 40% tells the office the opposite of what
                          the number beside it says. */}
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${tone.bar}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                      {request.studentsAnswered} of {request.rosterSize}
                    </span>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void remind(request)}
                  className="min-h-[var(--tap-min)] shrink-0 rounded-lg border border-[var(--color-border)] px-3 text-sm font-medium transition-transform active:scale-[0.98]"
                >
                  Remind
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-confirm-fg)]">
          Everything open has been answered for.
        </p>
      )}

      {submitted.length > 0 ? (
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink-muted)]">
          Submitted:{" "}
          {submitted.map((request) => request.audienceLabel).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
