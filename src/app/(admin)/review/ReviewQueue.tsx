"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Decision, ReviewItem } from "@/lib/submissions";
import { titleCaseName } from "@/lib/classes";
import { useToast } from "@/components/ui/Toast";
import { ThumbBar } from "@/components/admin/ThumbBar";
import { decide } from "./actions";

/**
 * Batch approve or reject.
 *
 * Everything actionable is ticked by default. The office's normal day is
 * "these all look right, approve the lot" — making them tick 30 boxes to do the
 * common thing would guarantee the queue never gets cleared.
 *
 * Superseded rows are hidden by default: they are earlier answers for a student
 * and field that has since been answered again, and approving the newest
 * resolves them anyway.
 */
export function ReviewQueue({
  items,
  canApprove,
}: {
  items: ReviewItem[];
  canApprove: boolean;
}) {
  // Rows the server has not caught up on yet. They leave the list the moment
  // she taps; if the action throws, React discards this and they come back.
  const [decided, setDecided] = useOptimistic<string[]>([]);

  const visible = items.filter((item) => !decided.includes(item.id));
  const live = visible.filter((item) => !item.superseded);
  const stale = visible.filter((item) => item.superseded);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((item) => !item.superseded).map((item) => item.id)),
  );
  const [showStale, setShowStale] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function submit(decision: Decision) {
    setError(null);
    const ids = [...selected];
    if (ids.length === 0) return;

    // Optimistic update and refresh inside ONE transition. Split them and the
    // rows reappear for a frame between the action resolving and the fresh
    // data landing.
    startTransition(async () => {
      setDecided(ids);
      try {
        await decide(ids, decision, note);
        setSelected(new Set());
        setNote("");
        router.refresh();

        // No undo offered, and that is deliberate. Approving writes through the
        // precedence rules into the master record; there is no clean inverse,
        // and a button labelled Undo that leaves the record changed would be
        // worse than not offering one. Say what happened instead.
        toast({
          message:
            decision === "approved"
              ? `${ids.length} ${ids.length === 1 ? "change is" : "changes are"} now in the master record.`
              : `${ids.length} ${ids.length === 1 ? "change" : "changes"} rejected. The master record is unchanged.`,
          tone: decision === "approved" ? "success" : "info",
        });
      } catch {
        setError(
          "That did not go through. Nothing has been changed — try again.",
        );
      }
    });
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = groupByRequest(showStale ? [...live, ...stale] : live);

  return (
    // pb-44: generous, because this bar wraps to three rows on a narrow phone
    // (count, select-all, note, then the two buttons).
    <div className="space-y-8 pb-44 md:pb-0">
      {/*
        The bar goes to the BOTTOM on a phone and stays at the top on a desktop.
        Same reasoning as the teacher's progress rail: this is the screen the
        office uses most, one hand, and the approve button belongs where the
        thumb already is. At md and up there is a mouse and a top bar reads as a
        toolbar, which is what it is there.
      */}
      <ThumbBar desktop="sticky">
          <span className="text-sm font-medium">
            {selected.size} of {live.length} selected
          </span>
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === live.length
                  ? new Set()
                  : new Set(live.map((item) => item.id)),
              )
            }
            className="inline-flex min-h-[var(--tap-min)] items-center px-1 text-sm text-[var(--color-brand-600)] hover:underline md:min-h-0"
          >
            {selected.size === live.length ? "Clear all" : "Select all"}
          </button>

          {/* Behind a disclosure below md: a text input inside a sticky thumb
              bar eats the whole bar at 390px, and a note is the rare case. */}
          <details className="w-full md:ml-auto md:w-auto">
            <summary className="cursor-pointer list-none py-1 text-label text-[var(--color-ink-muted)] md:hidden">
              {note ? `Note: ${note}` : "Add a note"}
            </summary>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note (optional)"
              className="mt-1 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--color-border)] px-3 text-sm md:mt-0 md:w-48 md:min-h-0 md:py-2"
            />
          </details>

          <div className="flex w-full gap-2 md:w-auto">
            <button
              type="button"
              onClick={() => submit("rejected")}
              disabled={!canApprove || selected.size === 0 || pending}
              className="min-h-[var(--tap-min)] flex-1 rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-danger)] transition-transform active:scale-[0.98] disabled:opacity-40 md:min-h-0 md:flex-none md:py-2"
            >
              Reject{selected.size > 0 ? ` ${selected.size}` : ""}
            </button>
            <button
              type="button"
              onClick={() => submit("approved")}
              disabled={!canApprove || selected.size === 0 || pending}
              className="min-h-[var(--tap-min)] flex-1 rounded-lg bg-[var(--color-success)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40 md:min-h-0 md:flex-none md:py-2"
            >
              {pending ? "Working…" : `Approve ${selected.size}`}
            </button>
          </div>
      </ThumbBar>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {!canApprove ? (
        <p className="rounded-lg border border-[var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-[var(--color-warning)]">
          Your role can view this queue but cannot approve changes into the
          master record. Ask an admin or the owner.
        </p>
      ) : null}

      {groups.map((group) => (
        <section
          key={group.requestId}
          className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        >
          <header className="flex flex-wrap items-baseline gap-2 border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="font-medium">{group.requestTitle}</h2>
            <span className="text-sm text-[var(--color-ink-muted)]">
              {group.audienceLabel} · {group.teacherName} ·{" "}
              {group.items.length} item{group.items.length === 1 ? "" : "s"}
            </span>
          </header>

          <ul className="divide-y divide-[var(--color-border)]">
            {group.items.map((item) => (
              <li key={item.id}>
                {/*
                  The whole row is the tap target, not a 16px checkbox in a
                  corner. On a phone that is the difference between a screen you
                  can work through one-handed and one you have to aim at. The
                  checkbox stays for the pointer and for the keyboard, and its
                  own click is stopped so it does not toggle twice.
                */}
                <label
                  className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-sm ${
                    item.superseded
                      ? "opacity-50"
                      : selected.has(item.id)
                        ? "bg-[var(--color-brand-50)]"
                        : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={item.superseded}
                    className="mt-1 h-5 w-5 shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-name font-medium">
                        {titleCaseName(item.studentName)}
                      </span>
                      <span className="text-meta text-[var(--color-ink-muted)]">
                        {item.fieldLabel}
                      </span>
                    </div>

                    <div className="mt-1">
                      {item.action === "not_present" ? (
                        <span className="rounded bg-[var(--color-absent-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-absent-fg)]">
                          teacher says not in this class
                        </span>
                      ) : (
                        <span className="font-mono text-xs">
                          <span className="line-through opacity-60">
                            {item.oldValue ?? "empty"}
                          </span>
                          <span className="mx-2" aria-hidden>
                            →
                          </span>
                          <span className="font-medium not-italic">
                            {item.newValue ?? "empty"}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Neutral. Siblings share a parent's phone — this is
                        context for the office, never a warning and never a
                        reason not to approve. */}
                    {item.alsoOn > 0 ? (
                      <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
                        also on {item.alsoOn} other{" "}
                        {item.alsoOn === 1 ? "student" : "students"} — usually
                        siblings
                      </p>
                    ) : null}

                    <p className="mt-0.5 font-mono text-meta text-[var(--color-ink-muted)]">
                      {item.studentId} ·{" "}
                      {item.superseded
                        ? "superseded"
                        : formatWhen(item.submittedAt)}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {stale.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowStale((current) => !current)}
          className="text-sm text-[var(--color-ink-muted)] hover:underline"
        >
          {showStale ? "Hide" : "Show"} {stale.length} superseded{" "}
          {stale.length === 1 ? "answer" : "answers"}
        </button>
      ) : null}

      <p className="text-xs text-[var(--color-ink-muted)]">
        Approving writes the change into the master record and logs who did it
        and when. &ldquo;Not in this class&rdquo; is recorded and logged but does
        not move the student — fix the class on the student record or by
        re-importing.
      </p>
    </div>
  );
}

type Group = {
  requestId: string;
  requestTitle: string;
  audienceLabel: string;
  teacherName: string;
  items: ReviewItem[];
};

function groupByRequest(items: ReviewItem[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const existing = groups.get(item.requestId);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.requestId, {
        requestId: item.requestId,
        requestTitle: item.requestTitle,
        audienceLabel: item.audienceLabel,
        teacherName: item.teacherName,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

function formatWhen(value: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
