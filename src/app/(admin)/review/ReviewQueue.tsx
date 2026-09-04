"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Decision, ReviewItem } from "@/lib/submissions";
import { titleCaseName } from "@/lib/classes";
import { useToast } from "@/components/ui/Toast";
import {
  ThumbBar,
  THUMB_BAR_COMPACT_CLEARANCE,
} from "@/components/admin/ThumbBar";
import { PhotoDiff } from "@/components/admin/StudentPhoto";
// `field` is already the name of this screen's field filter, hence the alias.
import {
  btn,
  card,
  chip,
  eyebrow,
  FOCUS,
  field as fieldClass,
} from "@/components/ui/controls";
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

  /**
   * Narrowing, not a second selection.
   *
   * A school-wide round is several hundred rows across nineteen classes, and
   * "approve the phone numbers but look at the photos properly" is the normal
   * way to work through it. Three dimensions is enough: which group it came
   * from, which field it is, and what the teacher did.
   *
   * A filter CHANGES THE SELECTION rather than hiding rows that stay ticked.
   * Approving a hidden row because it was ticked before a filter was applied is
   * the one failure this screen must not have — everything actionable being
   * ticked by default is only safe while "actionable" means "on screen".
   */
  const [audience, setAudience] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const matches = (item: ReviewItem) =>
    (audience === null || item.audienceLabel === audience) &&
    (field === null || item.fieldKey === field) &&
    (action === null || item.action === action);

  const visible = items.filter(
    (item) => !decided.includes(item.id) && matches(item),
  );
  const live = visible.filter((item) => !item.superseded);
  const stale = visible.filter((item) => item.superseded);

  /**
   * Everything actionable and currently on screen.
   *
   * The one definition of "what should be ticked", used by all three things
   * that need to answer it: the first render, a filter change, and the arrival
   * of fresh rows after an approve. It takes the filter as arguments rather
   * than reading state so `narrow` can call it with the values it is about to
   * set, which are not in state yet.
   */
  const actionable = (
    a: string | null,
    f: string | null,
    c: string | null,
  ): Set<string> =>
    new Set(
      items
        .filter(
          (item) =>
            !item.superseded &&
            !decided.includes(item.id) &&
            (a === null || item.audienceLabel === a) &&
            (f === null || item.fieldKey === f) &&
            (c === null || item.action === c),
        )
        .map((item) => item.id),
    );

  const [selected, setSelected] = useState<Set<string>>(() =>
    actionable(null, null, null),
  );

  /**
   * RE-TICK WHEN THE SERVER SENDS A NEW LIST.
   *
   * `selected` was seeded by a useState initialiser, which runs once. `submit`
   * clears it and calls router.refresh(), and nothing put it back — so from the
   * first approve onwards every remaining row sat unticked, and the promise at
   * the top of this file ("everything actionable is ticked by default") held
   * only until the office used the screen. They then either re-ticked thirty
   * boxes by hand or approved a subset believing it was the lot.
   *
   * Adjusting state during render against the previous props, rather than in an
   * effect: React re-runs this component before touching the DOM, so the list
   * never paints in the wrong state. `items` is a fresh array from the server
   * component on every refresh and keeps its identity between them, which is
   * exactly the signal wanted.
   *
   * It re-derives through the SAME filter the screen is currently showing, so
   * the invariant above — never tick a row that is not on screen — survives a
   * refresh just as it survives a filter change.
   */
  const [seen, setSeen] = useState(items);
  if (items !== seen) {
    setSeen(items);
    setSelected(actionable(audience, field, action));
  }

  /** Re-tick whatever the new filter reveals, and untick everything it hides. */
  function narrow(next: {
    audience?: string | null;
    field?: string | null;
    action?: string | null;
  }) {
    const a = next.audience !== undefined ? next.audience : audience;
    const f = next.field !== undefined ? next.field : field;
    const c = next.action !== undefined ? next.action : action;
    setAudience(a);
    setField(f);
    setAction(c);

    setSelected(actionable(a, f, c));
  }
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

  /*
   * THE KEYBOARD, for the one screen where a reviewer clears three hundred
   * rows in a sitting.
   *
   *   j / k   move the cursor down / up the live rows
   *   space   tick or untick the row under the cursor
   *   a / r   approve / reject what is ticked — the same submit the buttons call
   *
   * Nothing fires while an input, textarea or select has focus (the note box
   * lives in this component) or while a modifier is held, so typing a note
   * containing the letter a does not approve the queue. The cursor is a row
   * id, not an index: the list re-sorts when a filter changes, and an index
   * would land on a different child.
   */
  const [cursor, setCursor] = useState<string | null>(null);
  const order = live.map((item) => item.id);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const at = cursor ? order.indexOf(cursor) : -1;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = event.key === "j" ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1);
        const id = order[next];
        if (!id) return;
        setCursor(id);
        document.getElementById(`review-${id}`)?.scrollIntoView({ block: "nearest" });
      } else if (event.key === " " && cursor && order.includes(cursor)) {
        event.preventDefault();
        toggle(cursor);
      } else if (event.key === "a" && canApprove && selected.size > 0 && !pending) {
        submit("approved");
      } else if (event.key === "r" && canApprove && selected.size > 0 && !pending) {
        submit("rejected");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // submit/toggle close over current state; re-binding per render is the
    // cheap way to keep them current, and this is a screen with no other
    // per-keystroke work.
  });

  return (
    <div className={`space-y-8 ${THUMB_BAR_COMPACT_CLEARANCE}`}>
      {/*
        The bar goes to the BOTTOM on a phone and stays at the top on a desktop.
        Same reasoning as the teacher's progress rail: this is the screen the
        office uses most, one hand, and the approve button belongs where the
        thumb already is. At md and up there is a mouse and a top bar reads as a
        toolbar, which is what it is there.
      */}
      <ThumbBar desktop="sticky" mobile="compact">
        <div className="flex w-full items-center gap-2 md:w-auto">
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

          {/* The rare note opens above the rail rather than adding a third row. */}
          <details className="relative ml-auto md:hidden">
            <summary className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center px-1 text-sm text-[var(--color-ink-muted)] ${FOCUS}`}>
              {note ? "Note added" : "Add note"}
            </summary>
            <div className={`${card()} absolute bottom-full right-0 mb-2 w-[min(20rem,calc(100vw-2rem))] p-3 shadow-raised`}>
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                  Decision note
                </span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional"
                  className={`${fieldClass()} mt-1`}
                />
              </label>
            </div>
          </details>
        </div>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          aria-label="Decision note"
          className={`${fieldClass()} ml-auto hidden md:block md:min-h-0 md:w-48 md:py-2`}
        />

        {/* Approve gets twice the width of Reject. They are not equal
            choices: approving is what the office came here to do, rejecting
            is the exception, and two identical buttons side by side under a
            thumb is how the wrong one gets pressed. */}
        <div className="flex w-full gap-2 md:w-auto">
            <button
              type="button"
              onClick={() => submit("rejected")}
              disabled={!canApprove || selected.size === 0 || pending}
              className={`${btn({ tone: "danger" })} flex-1 md:min-h-0 md:flex-none md:py-2`}
            >
              Reject{selected.size > 0 ? ` ${selected.size}` : ""}
            </button>
            <button
              type="button"
              onClick={() => submit("approved")}
              disabled={!canApprove || selected.size === 0 || pending}
              className={`${btn({ tone: "go" })} flex-[2] md:min-h-0 md:flex-none md:py-2`}
            >
              {pending ? "Working…" : `Approve ${selected.size}`}
            </button>
        </div>
      </ThumbBar>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {!canApprove ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-warning)] bg-[var(--color-correct-bg)] px-4 py-3 text-sm text-[var(--color-warning-fg)]">
          Your role can view this queue but cannot approve changes into the
          master record. Ask an admin or the owner.
        </p>
      ) : (
        <p className="hidden text-xs text-[var(--color-ink-muted)] md:block">
          Keyboard: <kbd className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">j</kbd>/
          <kbd className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">k</kbd> move,{" "}
          <kbd className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">space</kbd> tick,{" "}
          <kbd className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">a</kbd> approve,{" "}
          <kbd className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">r</kbd> reject the ticked rows.
        </p>
      )}

      <ReviewFilters
        items={items.filter((item) => !decided.includes(item.id))}
        audience={audience}
        field={field}
        action={action}
        onNarrow={narrow}
      />

      {groups.map((group) => (
        <section
          key={group.requestId}
          className={`${card()} overflow-hidden`}
        >
          <header className="flex flex-wrap items-baseline gap-2 border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-[15px] font-medium">{group.requestTitle}</h2>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {group.audienceLabel} · {group.teacherName} ·{" "}
              {group.items.length} item{group.items.length === 1 ? "" : "s"}
            </span>
            {/* Approving one class at a time beats unticking two hundred rows
                to get at nineteen. It earned its place on marks rounds, which
                no longer queue at all; a school-wide phone round is still
                nineteen classes deep and still wants it. */}
            <button
              type="button"
              onClick={() =>
                setSelected(
                  new Set(
                    group.items
                      .filter((item) => !item.superseded)
                      .map((item) => item.id),
                  ),
                )
              }
              className="ml-auto min-h-[var(--tap-min)] px-1 text-[13px] text-[var(--color-brand-600)] hover:underline md:min-h-0"
            >
              Only this one
            </button>
          </header>

          <ul className="divide-y divide-[var(--color-border)]">
            {group.items.map((item) => (
              <li key={item.id} id={`review-${item.id}`}>
                {/*
                  The whole row is the tap target, not a 16px checkbox in a
                  corner. On a phone that is the difference between a screen you
                  can work through one-handed and one you have to aim at. The
                  checkbox stays for the pointer and for the keyboard, and its
                  own click is stopped so it does not toggle twice.

                  The keyboard cursor is the same ring focus-visible draws —
                  never a colour alone (controls.ts).
                */}
                <label
                  className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-sm ${
                    item.superseded
                      ? "opacity-50"
                      : selected.has(item.id)
                        ? "bg-[var(--color-brand-50)]"
                        : ""
                  } ${cursor === item.id ? "outline-solid outline-2 -outline-offset-2 outline-[var(--color-brand-600)]" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={item.superseded}
                    className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-[5px]"
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
                      ) : item.inputType === "photo" ? (
                        /* A pathname printed in a monospace cell would mean
                           approving a photograph of a child that nobody has
                           looked at. Old and new, side by side, old dimmed. */
                        <PhotoDiff
                          before={item.oldValue}
                          after={item.newValue}
                          name={item.studentName}
                        />
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

/**
 * Three rows of chips: which group, which field, what the teacher did.
 *
 * Counted over everything still pending, NOT over what the current filter
 * leaves — a chip list that shrinks as you use it means the one you want
 * disappears the moment you pick another, with no way back except clearing.
 *
 * A row is only rendered when it has more than one value to choose between. A
 * single chip labelled "Mobile 42" next to a queue that is entirely mobile
 * numbers is a control that cannot do anything.
 */
function ReviewFilters({
  items,
  audience,
  field,
  action,
  onNarrow,
}: {
  items: ReviewItem[];
  audience: string | null;
  field: string | null;
  action: string | null;
  onNarrow: (next: {
    audience?: string | null;
    field?: string | null;
    action?: string | null;
  }) => void;
}) {
  const count = <K extends keyof ReviewItem>(key: K, label: (item: ReviewItem) => string) => {
    const map = new Map<string, { label: string; n: number }>();
    for (const item of items) {
      const value = String(item[key]);
      const entry = map.get(value) ?? { label: label(item), n: 0 };
      entry.n += 1;
      map.set(value, entry);
    }
    return [...map.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  };

  const audiences = count("audienceLabel", (item) => item.audienceLabel);
  const fields = count("fieldKey", (item) => item.fieldLabel);
  const actions = count("action", (item) =>
    item.action === "not_present" ? "Not in this class" : "Changed",
  );

  const rows: ReviewFilterRow[] = [
    ["Group", audiences, audience, (value) => onNarrow({ audience: value })],
    ["Field", fields, field, (value) => onNarrow({ field: value })],
    ["Answer", actions, action, (value) => onNarrow({ action: value })],
  ];

  const useful = rows.filter(([, values]) => values.length > 1);
  if (useful.length === 0) return null;
  const activeCount = [audience, field, action].filter(Boolean).length;

  return (
    <>
      <div className={`${card()} md:hidden`}>
        <details className="group">
          <summary className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center px-4 text-sm font-semibold text-[var(--color-brand-600)] md:hidden ${FOCUS}`}>
            Filter changes
            {activeCount > 0 ? (
              <span className="ml-2 rounded-[var(--radius-chip)] bg-[var(--color-brand-50)] px-2 py-0.5 font-mono text-xs text-[var(--color-brand-700)]">
                {activeCount}
              </span>
            ) : null}
          </summary>
          <div className="p-4 pt-1">
            <ReviewFilterControls rows={useful} />
          </div>
        </details>
      </div>
      <div className={`${card()} hidden p-4 md:block`}>
        <ReviewFilterControls rows={useful} />
      </div>
    </>
  );
}

type ReviewFilterRow = [
  label: string,
  values: [string, { label: string; n: number }][],
  current: string | null,
  set: (value: string | null) => void,
];

function ReviewFilterControls({ rows }: { rows: ReviewFilterRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map(([label, values, current, set]) => (
        <div key={label}>
          <span className={eyebrow()}>{label}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip active={current === null} onClick={() => set(null)}>
              All
            </Chip>
            {values.map(([value, entry]) => (
              <Chip
                key={value}
                active={current === value}
                onClick={() => set(current === value ? null : value)}
              >
                {entry.label}
                <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                  {entry.n}
                </span>
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${chip({ on: active, pill: true })} ${
        active ? "" : "hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {children}
    </button>
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
