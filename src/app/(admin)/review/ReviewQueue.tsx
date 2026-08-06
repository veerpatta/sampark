"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Decision, ReviewItem } from "@/lib/submissions";
import { titleCaseName } from "@/lib/classes";
import { useToast } from "@/components/ui/Toast";
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
    <div className="space-y-8">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card px-4 py-3">
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
          className="text-sm text-[var(--color-brand-600)] hover:underline"
        >
          {selected.size === live.length ? "Clear all" : "Select all"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            className="w-48 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => submit("rejected")}
            disabled={!canApprove || selected.size === 0 || pending}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] disabled:opacity-40"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => submit("approved")}
            disabled={!canApprove || selected.size === 0 || pending}
            className="rounded-lg bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {pending ? "Working…" : `Approve ${selected.size}`}
          </button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)] bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]"
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
              {group.classLabel} · {group.teacherName} ·{" "}
              {group.items.length} item{group.items.length === 1 ? "" : "s"}
            </span>
          </header>

          <table className="w-full text-sm">
            <tbody>
              {group.items.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    item.superseded ? "opacity-50" : ""
                  }`}
                >
                  <td className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      disabled={item.superseded}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium">
                      {titleCaseName(item.studentName)}
                    </div>
                    <div className="font-mono text-xs text-[var(--color-ink-muted)]">
                      {item.studentId}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-ink-muted)]">
                    {item.fieldLabel}
                  </td>
                  <td className="px-2 py-2">
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
                    {/* Neutral. Siblings share a parent's phone — this is
                        context for the office, never a warning and never a
                        reason not to approve. */}
                    {item.alsoOn > 0 ? (
                      <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                        also on {item.alsoOn} other{" "}
                        {item.alsoOn === 1 ? "student" : "students"} — usually
                        siblings
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-[var(--color-ink-muted)]">
                    {item.superseded ? "superseded" : formatWhen(item.submittedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  classLabel: string;
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
        classLabel: item.classLabel,
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
