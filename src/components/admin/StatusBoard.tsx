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
 */
export function StatusBoard({ requests }: { requests: RequestBoardRow[] }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  // One row per class: the newest open request. Without a "round" entity that
  // is the closest thing to "where is this collection up to".
  const newestPerClass = new Map<string, RequestBoardRow>();
  for (const request of requests) {
    if (request.status !== "open") continue;
    if (!newestPerClass.has(request.classLabel)) {
      newestPerClass.set(request.classLabel, request);
    }
  }
  const open = [...newestPerClass.values()];
  if (open.length === 0) return null;

  const done = (request: RequestBoardRow) =>
    request.rosterSize > 0 && request.studentsAnswered >= request.rosterSize;

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
      classLabel: request.classLabel,
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
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-6">
      <h2 className="text-xl font-semibold tracking-tight">
        {submitted.length} of {open.length}{" "}
        {open.length === 1 ? "class has" : "classes have"} submitted
      </h2>

      {waiting.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {waiting.map((request) => {
            const late = request.dueDate < today;
            const percent =
              request.rosterSize === 0
                ? 0
                : Math.round(
                    (request.studentsAnswered / request.rosterSize) * 100,
                  );
            return (
              <li
                key={request.id}
                className="flex items-center gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/requests/${request.id}`}
                    className="font-medium hover:text-[var(--color-brand-600)] hover:underline"
                  >
                    {request.classLabel}
                  </Link>
                  <span className="ml-2 text-sm text-[var(--color-ink-muted)]">
                    {request.teacher}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-success)] transition-[width] duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                      {request.studentsAnswered} of {request.rosterSize}
                    </span>
                    {late ? (
                      <span className="text-xs font-medium text-[var(--color-danger)]">
                        overdue
                      </span>
                    ) : null}
                  </div>
                </div>
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
          Submitted: {submitted.map((request) => request.classLabel).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
