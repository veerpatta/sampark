"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretRight, CheckCircle, CloudCheck } from "@phosphor-icons/react";
import { StudentRow } from "./StudentRow";
import { ProgressRail } from "./ProgressRail";
import { ReviewSummary } from "./ReviewSummary";
import { summarise } from "./summary";
import { tick } from "./haptics";
import { useToast } from "@/components/ui/Toast";
import {
  clearDraft,
  loadDraft,
  newIdempotencyKey,
  saveDraft,
  type PendingBatch,
} from "./draft";
import {
  judgeRow,
  pickBatch,
  shouldFlush,
  ROW_COMMIT_MS,
} from "./autosave";
import { canCarryDown, suggestForRow } from "./suggest";
import { Bi } from "./Bi";
import { watchKeyboard } from "./focus";
import { PhotoProvider } from "./photo-context";
import { T, type Phrase } from "./strings";
import {
  COMPLETE,
  UPLOADABLE,
  requiredKeys,
  type RowState,
  type RowStatus,
  type TeacherField,
  type TeacherRosterRow,
} from "./types";

/**
 * The teacher's whole screen.
 *
 * State lives here rather than in each row so the counts are computable, so
 * there is one object to persist to the phone, and one place to replay from
 * when signal comes back.
 *
 * THE SPLIT IS THE POINT. A Class 8 teacher opens this with 46 students, of
 * whom 40 already have a correct number and 6 have nothing. The 6 are the entire
 * reason the request was sent and she used to have to hunt for them among 46
 * identical cards, then spend 40 taps confirming what was already right. So:
 * the blanks come first with their inputs already open, and the 40 are
 * confirmed by one button.
 *
 * Nothing here decides what a submission MEANS. The browser reports what she
 * typed; the server compares it against the frozen snapshot and works out
 * whether that is a confirmation or a change. See lib/submissions.ts.
 *
 * Two states are deliberately distinct and both visible:
 *   saved on phone  — in localStorage, safe from a closed tab or a flat battery
 *   sent to school  — the server has it
 * Collapsing those into one tick would be a lie on a bad signal, and the whole
 * point of showing it is that she can put the phone down and trust it. This
 * matters MORE now that both happen by themselves: with no send button there is
 * no moment that means "I have handed this over", so the row has to say it.
 *
 * SHE DOES NOT PRESS ANYTHING TO SAVE. A row commits itself a second after she
 * stops typing, and committed rows upload in the background. The old per-row
 * "हो गया" only ever flipped a local status — it looked like a save button and
 * was not one — and the send screen behind it cost her a review of forty rows
 * she had already read once.
 *
 * WHAT THAT TRADES AWAY, SAID PLAINLY. The review screen used to guarantee she
 * had seen what she was submitting. It is now a receipt: it shows what has gone
 * and lets her correct any of it, and a correction supersedes what went before.
 * That is only safe because the office /review queue is unchanged and is still
 * the only door into the master record — nothing a teacher types here reaches a
 * student record without an approval carrying a user id.
 */

type Stage = "list" | "review";

/** How long to stand down after a 429 before trying again. */
const RATE_LIMIT_BACKOFF_MS = 15_000;

/**
 * The suggestions object for a round that has none — shared, frozen, and the
 * same object every time.
 *
 * Most rounds carry no suggestions at all: canCarryDown refuses `tel` and
 * refuses anything with a fixed length, which is every field on a phone round,
 * an Aadhaar round and a marks round. Those rounds were still building one
 * fresh object per child per render, full of nulls — and a fresh object is a
 * changed prop, which is what stops a memoised row from staying put.
 */
const NO_SUGGESTIONS: Record<string, string | null> = Object.freeze({});

/** The same reasoning, for a student with no holes to fill. */
const NO_REQUIRED: string[] = [];

export function RequestForm({
  token,
  fields,
  roster,
}: {
  token: string;
  fields: TeacherField[];
  roster: TeacherRosterRow[];
}) {
  const router = useRouter();
  const toast = useToast();

  /**
   * Which fields each student genuinely has to answer for.
   *
   * Computed once, here, because three separate things need it and none of them
   * should be re-deriving what counts as a hole: the blanks/known split, the
   * commit gate, and the row's own "what is still missing" line.
   */
  const requiredByStudent = useMemo(
    () =>
      new Map(
        roster.map((student) => [
          student.studentId,
          requiredKeys(student, fields),
        ]),
      ),
    [roster, fields],
  );

  // Blanks first. Order within each group is the name order the server sent.
  const { blanks, known, blankIds } = useMemo(() => {
    const blanks: TeacherRosterRow[] = [];
    const known: TeacherRosterRow[] = [];
    for (const student of roster) {
      const required = requiredByStudent.get(student.studentId) ?? [];
      (required.length > 0 ? blanks : known).push(student);
    }
    return {
      blanks,
      known,
      blankIds: new Set(blanks.map((student) => student.studentId)),
    };
  }, [roster, requiredByStudent]);

  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      roster.map((student) => [
        student.studentId,
        { status: "todo", values: {} } as RowState,
      ]),
    ),
  );
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Phrase | null>(null);
  const [online, setOnline] = useState(true);
  const [restored, setRestored] = useState(false);
  /**
   * Not persisted to the draft. On reload she lands on the list with her
   * answers restored; dropping her into a review screen she did not ask for is
   * worse than one extra tap.
   */
  const [stage, setStage] = useState<Stage>("list");
  /** Set when she jumps back from review, so the row can be scrolled to. */
  const [focusId, setFocusId] = useState<string | null>(null);

  /**
   * The upload in flight, or the last one that failed. One key per upload, held
   * until the server acknowledges it — see PendingBatch in draft.ts for why it
   * is neither one key per session nor a fresh key per retry.
   */
  const pending = useRef<PendingBatch | null>(null);
  /** Students inside the request currently in the air. */
  const inFlight = useRef<Set<string>>(new Set());
  const lastCommitAt = useRef(0);
  const lastFlushAt = useRef(0);
  /** Per-row commit timers, so typing in one row cannot reset another's. */
  const commitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Mirrors, so the pagehide handler reads the latest state without being
  // re-registered on every keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const sentRef = useRef(sentIds);
  sentRef.current = sentIds;

  /* ------------------------------------------------ restore what she had */
  useEffect(() => {
    const draft = loadDraft(token);
    if (draft) {
      // Only keep rows for students still on the roster — the office may have
      // re-sent a corrected request under the same token.
      const known = new Set(roster.map((student) => student.studentId));
      const kept = Object.fromEntries(
        Object.entries(draft.rows).filter(([id]) => known.has(id)),
      );
      if (Object.keys(kept).length > 0) {
        setRows((current) => ({ ...current, ...kept }));
        setRestored(true);
      }
      setSentIds(new Set(draft.sent.filter((id) => known.has(id))));
      pending.current = draft.pending;
    }
    setOnline(navigator.onLine);
  }, [token, roster]);

  /*
   * Keep the box she is typing into above the keyboard.
   *
   * Mounted once for the whole list rather than per field: the keyboard opens,
   * changes height when she switches to the number pad, and the page reflows
   * under it every time a row commits and collapses. A scroll fired on focus
   * catches only the first of those. See components/teacher/focus.ts.
   */
  useEffect(() => watchKeyboard(), []);

  /* --------------------------------------------------- save as she types */
  //
  // Debounced, unlike the first version. localStorage.setItem is synchronous
  // and this serialises the whole rows object, so writing on every keystroke
  // janks the old Android phones this is for. 300ms is well inside the window
  // where a dropped tab loses nothing — and pagehide below flushes it anyway,
  // because a debounce must never be the reason the only copy was not written.
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(token, {
        rows,
        sent: [...sentIds],
        pending: pending.current,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [token, rows, sentIds]);

  /**
   * Finished rows. COMPLETE, not UPLOADABLE — a partial row has been sent and
   * is still not done, and this is the number the progress rail counts down and
   * the number the "पूरा हुआ" card waits for.
   */
  const done = useMemo(
    () => Object.values(rows).filter((row) => COMPLETE.includes(row.status)).length,
    [rows],
  );

  /**
   * Anything she has touched enough to look at on the receipt.
   *
   * Separate from `done` so a teacher whose work so far is all partial is not
   * locked out of the review screen by a button disabled on a count that
   * deliberately excludes her.
   */
  const reviewable = useMemo(
    () => Object.values(rows).filter((row) => UPLOADABLE.includes(row.status)).length,
    [rows],
  );

  /** On the phone but not yet acknowledged. A partial row genuinely is in flight. */
  const unsent = useMemo(
    () =>
      roster.filter(
        (student) =>
          UPLOADABLE.includes(rows[student.studentId]!.status) &&
          !sentIds.has(student.studentId),
      ),
    [roster, rows, sentIds],
  );

  const activeStudentId = useMemo(
    () => {
      const ordered = [...blanks, ...known];
      const editing = ordered.find((student) =>
        ["editing", "partial"].includes(rows[student.studentId]!.status),
      );
      return (
        editing?.studentId ??
        ordered.find(
          (student) => !COMPLETE.includes(rows[student.studentId]!.status),
        )?.studentId ??
        null
      );
    },
    [blanks, known, rows],
  );

  /**
   * Fields a value can be carried down for at all.
   *
   * Asked once for the whole round rather than once per field per row per
   * render. On the rounds where this is empty — which is most of them — the
   * per-row work below disappears entirely.
   */
  const carryFields = useMemo(() => fields.filter(canCarryDown), [fields]);

  /** Known-group students she has not touched yet — what "सब सही हैं" covers. */
  const untouchedKnown = useMemo(
    () => known.filter((student) => rows[student.studentId]!.status === "todo"),
    [known, rows],
  );

  /*
   * Stable across renders, and that is load-bearing now rather than tidy.
   *
   * Every dependency is a ref or a setState — the mirror below is exactly why
   * this needs no `rows` in its closure — so an empty dependency list is
   * honest. A fresh `update` on every keystroke would rebuild every row's
   * handlers, which would change every row's props, which would defeat the
   * memo on StudentRow entirely.
   */
  const update = useCallback(function update(
    studentId: string,
    patch: Partial<RowState>,
  ) {
    // The mirror is written synchronously here rather than left to the next
    // render. Filling the last digit of a fixed-length field calls commitNow in
    // the SAME event as this update, and a commit that judged the state from
    // before the keystroke would refuse the row and clear its timer in one go —
    // leaving it sitting uncommitted until she happened to blur it.
    const next = {
      ...rowsRef.current,
      [studentId]: { ...rowsRef.current[studentId]!, ...patch },
    };
    rowsRef.current = next;
    setRows(next);
    // Touching a row again un-sends it, so a correction after a send is not
    // silently dropped. It will go up again in the next batch, under a new key,
    // and the server supersedes what came before.
    setSentIds((current) => {
      if (!current.has(studentId)) return current;
      const next = new Set(current);
      next.delete(studentId);
      return next;
    });
    if (patch.status && patch.status !== "editing") {
      lastCommitAt.current = Date.now();
    }
  }, []);

  /**
   * A row commits itself once she stops typing.
   *
   * This is what the "हो गया" button used to do — and that button never saved
   * anything, it only flipped this status, which is exactly why it could go.
   *
   * Three outcomes, not two. A row that is `unfinished` STAYS `editing` and is
   * not counted as anything: a half-typed phone number is not an answer, and a
   * timer must never be the thing that decides it was. A row that is settled but
   * still has an empty box the school holds nothing for becomes `partial` — it
   * goes to the school, it stays open on screen, and it is NOT done. Only a row
   * with every hole filled becomes `edited`.
   *
   * The judging happens outside setRows, against the rowsRef mirror. An updater
   * has to be pure — React double-invokes it in development — and tick() is a
   * side effect that must fire once, on a genuine completion.
   */
  const commit = useCallback(
    (studentId: string) => {
      const row = rowsRef.current[studentId];
      if (!row) return;
      if (row.status !== "editing" && row.status !== "partial") return;

      const verdict = judgeRow(
        fields,
        row,
        requiredByStudent.get(studentId) ?? [],
      );
      if (verdict === "unfinished") return;

      const status: RowStatus = verdict === "ready" ? "edited" : "partial";
      if (row.status === status) return;

      lastCommitAt.current = Date.now();
      // A tick means "that is finished". A partial row is not finished, and
      // buzzing at her would say it was — the colour and the "2 में से 1 भरा"
      // line are what carry that case instead.
      if (status === "edited") tick();
      setRows((current) => ({
        ...current,
        [studentId]: { ...current[studentId]!, status },
      }));
    },
    [fields, requiredByStudent],
  );

  /** Restart this row's timer. Typing in one row must not commit another. */
  const scheduleCommit = useCallback(
    (studentId: string) => {
      const timers = commitTimers.current;
      const existing = timers.get(studentId);
      if (existing) clearTimeout(existing);
      timers.set(
        studentId,
        setTimeout(() => {
          timers.delete(studentId);
          commit(studentId);
        }, ROW_COMMIT_MS),
      );
    },
    [commit],
  );

  /** Leaving the row, or filling its last field, does not need the wait. */
  const commitNow = useCallback(
    (studentId: string) => {
      const existing = commitTimers.current.get(studentId);
      if (existing) clearTimeout(existing);
      commitTimers.current.delete(studentId);
      commit(studentId);
    },
    [commit],
  );

  useEffect(() => {
    const timers = commitTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  /**
   * A photograph has reached the school; write its pathname into the row.
   *
   * This is the ONE place a value arrives from somewhere other than her
   * fingers, and from here on it is indistinguishable from one she typed: the
   * row commits, the batch flushes, the server diffs it against the frozen
   * snapshot, and the office approves it. `commitNow` rather than the timer,
   * because an upload finishing is not typing — there is nothing to wait for.
   */
  function onPhotoUploaded(studentId: string, pathname: string) {
    const row = rowsRef.current[studentId];
    if (!row || !photoFieldKey) return;
    const next = {
      ...rowsRef.current,
      [studentId]: {
        ...row,
        status: "editing" as RowStatus,
        values: { ...row.values, [photoFieldKey]: pathname },
      },
    };
    rowsRef.current = next;
    setRows(next);
    commitNow(studentId);
  }

  /**
   * Which field, if any, is the photograph.
   *
   * Read off the registry rather than compared against a literal 'photo', so a
   * second photo field added as a row in field_defs works without a deploy —
   * rule 11. Null when this request does not ask for one, which is most of them.
   */
  const photoFieldKey =
    fields.find((field) => field.inputType === "photo")?.key ?? null;
  const hasPhotoField = photoFieldKey !== null;

  /**
   * Confirm the whole known group in one tap.
   *
   * Deliberately narrow. It touches ONLY untouched rows in the known group:
   *
   *   - never the blanks group. Mass-confirming an empty field would tell the
   *     office it had been checked when nobody has looked at it, and that is a
   *     worse outcome than the field staying empty.
   *   - never a row she has already answered, so it cannot quietly overwrite a
   *     correction she just made.
   *   - it does NOT submit. Confirm and send stay separate.
   */
  function confirmAllKnown() {
    if (untouchedKnown.length === 0) return;
    const before = Object.fromEntries(
      untouchedKnown.map((student) => [
        student.studentId,
        rows[student.studentId]!,
      ]),
    );

    // Same mirror discipline as update(): one object, written to both, so
    // nothing that reads rowsRef between now and the next render sees the
    // forty rows as still untouched.
    const next = { ...rowsRef.current };
    for (const student of untouchedKnown) {
      next[student.studentId] = { status: "confirmed", values: {} };
    }
    rowsRef.current = next;
    setRows(next);

    // One tick for the whole action, not one per student. Forty buzzes from a
    // single tap would read as a fault, not as feedback.
    tick();

    // Ten seconds to take it back. The only thing worse than forty taps is
    // forty taps undone one at a time. This used to be an inline strip that
    // pushed the list down as it appeared and again as it went; the toast sits
    // over the list instead, at the bottom, next to her thumb.
    toast({
      message: <Bi t={T.markedCorrect(untouchedKnown.length)} />,
      undoLabel: T.undo.en,
      duration: 10_000,
      tone: "success",
      undo: () => setRows((current) => ({ ...current, ...before })),
    });
  }


  /**
   * The receipt, built only when she is looking at it.
   *
   * `summarise` walks the whole roster building arrays, and this ran on every
   * keystroke to produce a value read by exactly one branch — the review screen
   * — which is not on screen while she is typing. Forty-six children of work,
   * forty-six times a number, thrown away every time.
   */
  /**
   * One set of callbacks per child, built once and kept.
   *
   * These used to be six arrow functions written inline in the row's JSX, so
   * every child got six brand-new functions on every render — and a new
   * function is a changed prop. Nothing could be memoised while that was true:
   * one digit typed into row 8 re-rendered all forty-six rows, each of them
   * re-running validateField over its own values.
   *
   * They read `rowsRef.current` rather than `rows`, which is what lets the
   * dependency list be the roster instead of the answers. That is the same
   * mirror discipline `update` relies on, and it is why this is safe: the ref
   * is written synchronously in `update`, so a handler firing between two
   * renders still sees the latest values.
   */
  const handlers = useMemo(() => {
    const map = new Map<
      string,
      {
        onConfirm: () => void;
        onEdit: () => void;
        onReopen: () => void;
        onLeave: () => void;
        onFilledLast: () => void;
        onChange: (fieldKey: string, value: string) => void;
      }
    >();
    for (const student of roster) {
      const id = student.studentId;
      map.set(id, {
        onConfirm: () => update(id, { status: "confirmed" }),
        onEdit: () => update(id, { status: "editing" }),
        onReopen: () => update(id, { status: "todo" }),
        onLeave: () => commitNow(id),
        onFilledLast: () => commitNow(id),
        onChange: (fieldKey, value) => {
          update(id, {
            status: "editing",
            values: { ...rowsRef.current[id]!.values, [fieldKey]: value },
          });
          scheduleCommit(id);
        },
      });
    }
    return map;
  }, [roster, update, commitNow, scheduleCommit]);

  const summary = useMemo(
    () => (stage === "review" ? summarise(roster, fields, rows) : null),
    [stage, roster, fields, rows],
  );

  /**
   * Android's back button should leave the review screen, not the whole form.
   *
   * This is the one thing a separate route would have given for free, so it is
   * replicated by hand: push a history entry on the way in, pop back to the
   * list when the browser goes back.
   */
  function openReview() {
    setError(null);
    setStage("review");
    window.history.pushState({ sampark: "review" }, "");
  }

  const closeReview = useCallback(() => setStage("list"), []);

  useEffect(() => {
    if (stage !== "review") return;
    window.scrollTo({ top: 0, behavior: "auto" });
    function onPop() {
      setStage("list");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stage]);

  /**
   * Jump back from the summary to one row, opened and in view.
   *
   * It used to have to reveal the batch that row was hiding in first. The whole
   * list is rendered now, so every row is always there to scroll to.
   */
  function fix(studentId: string) {
    setStage("list");
    setFocusId(studentId);
    update(studentId, { status: "editing" });
  }

  useEffect(() => {
    if (stage !== "list" || !focusId) return;
    const element = document.getElementById(`student-${focusId}`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFocusId(null);
  }, [stage, focusId]);

  /**
   * Upload everything answered and not yet acknowledged.
   *
   * Never per keystroke and never per row: rows pile up and go together, at most
   * one request in the air, and never closer together than
   * MIN_FLUSH_INTERVAL_MS. The teacher bucket is 30 a minute per token and a
   * retry needs headroom inside it.
   */
  const flush = useCallback(
    async (options: { manual?: boolean } = {}) => {
      if (inFlight.current.size > 0) return;

      // A live pending batch is one that left and was not acknowledged. Replay
      // exactly it, under exactly its key, so the unique index no-ops whatever
      // the server already wrote. Anything else she has answered since waits
      // for the next round.
      const replaying = pending.current !== null;
      const key = pending.current?.key ?? newIdempotencyKey();
      const carried = pending.current?.studentIds ?? [];

      const ids =
        replaying && carried.length > 0
          ? carried.filter((id) => !sentIds.has(id))
          : pickBatch(roster, rows, sentIds, inFlight.current);

      if (ids.length === 0) {
        pending.current = null;
        return;
      }

      pending.current = { key, studentIds: ids };
      inFlight.current = new Set(ids);
      lastFlushAt.current = Date.now();
      setBusy(true);
      if (options.manual) setError(null);

      // `absent` can no longer be produced — the button that set it was removed.
      // The branch stays because a draft saved on her phone before that change
      // still holds rows in that state, and it has to reach the school rather
      // than be silently re-read as an ordinary unanswered row.
      const payload = ids.map((studentId) => {
        const row = rows[studentId]!;
        return {
          studentId,
          notPresent: row.status === "absent",
          values: row.status === "absent" ? {} : row.values,
        };
      });

      try {
        const response = await fetch(`/api/r/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ students: payload, idempotencyKey: key }),
        });

        if (response.status === 404) {
          setError(T.linkDead);
          return;
        }
        if (response.status === 429) {
          // Real backoff. Pushing the next attempt out past the window is the
          // only thing that helps; retrying immediately hits the same wall and
          // burns the budget a genuine retry needs.
          lastFlushAt.current = Date.now() + RATE_LIMIT_BACKOFF_MS;
          setError(T.tooFast);
          return;
        }
        if (response.status === 422) {
          setError(T.someInvalid);
          return;
        }
        if (!response.ok) {
          setError(T.sendFailed);
          return;
        }

        pending.current = null;
        setSentIds((current) => new Set([...current, ...ids]));
        setError(null);
      } catch {
        // No signal. The draft is on the phone and the pending batch is kept,
        // so the retry replays the same batch under the same key.
        setError(null);
      } finally {
        inFlight.current = new Set();
        setBusy(false);
      }
    },
    [roster, rows, sentIds, token],
  );

  /* ------------------------------------------------ the background uploader */
  //
  // A single interval rather than a timer per commit: one thing to reason about,
  // and shouldFlush holds all the rules.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const timer = setInterval(() => {
      if (!navigator.onLine) return;
      const waiting = pickBatch(roster, rows, sentIds, inFlight.current).length;
      if (
        shouldFlush(
          waiting,
          Date.now() - lastCommitAt.current,
          Date.now() - lastFlushAt.current,
        )
      ) {
        void flushRef.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [roster, rows, sentIds]);

  /* --------------------------------------- retry the moment signal returns */
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      void flushRef.current();
    }
    function goOffline() {
      setOnline(false);
    }

    /**
     * Closing the tab must not strand the last few rows.
     *
     * keepalive lets the request outlive the page. An unacknowledged POST that
     * the server did record is harmless — the pending key survives in the draft
     * and the unique index no-ops the replay on the next load.
     */
    function onHide() {
      saveDraft(token, {
        rows: rowsRef.current,
        sent: [...sentRef.current],
        pending: pending.current,
      });

      const ids = pickBatch(
        roster,
        rowsRef.current,
        sentRef.current,
        inFlight.current,
      );
      if (ids.length === 0) return;

      const key = pending.current?.key ?? newIdempotencyKey();
      pending.current = { key, studentIds: ids };

      try {
        void fetch(`/api/r/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            students: ids.map((studentId) => {
              const row = rowsRef.current[studentId]!;
              return {
                studentId,
                notPresent: row.status === "absent",
                values: row.status === "absent" ? {} : row.values,
              };
            }),
            idempotencyKey: key,
          }),
        });
      } catch {
        /* the draft is written; the next load will replay it */
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") onHide();
    }

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, roster]);

  /*
   * DOES THIS LINK CARRY MORE THAN ONE REGISTER?
   *
   * A class link does not, and saying "Class 8" above every child on a Class 8
   * list is noise. A SUBJECT link does: one link per (teacher, subject) merges
   * every class that teacher takes it for, so Chemistry arrived as eighty-four
   * names in one alphabetical run with nothing anywhere to say which register
   * any of them came from. Same for a house or a route.
   */
  const spansClasses = useMemo(
    () => new Set(roster.map((student) => student.classLabel)).size > 1,
    [roster],
  );

  const renderRow = (
    student: TeacherRosterRow,
    index: number,
    group: TeacherRosterRow[],
  ) => {
    // The roster is sorted class-first (see resolveToken), so a change of class
    // between one row and the last is the start of a new register.
    const startsClass =
      spansClasses && student.classLabel !== (group[index - 1]?.classLabel ?? null);

    return (
      <Fragment key={student.studentId}>
        {startsClass && student.classLabel ? (
          /* Not sticky. It was, against a CSS variable nothing sets, so it
             pinned to the very top and slid under the page header — which sits
             above it — and vanished. A divider does not need to stick anyway:
             the class chip on every row is what answers "which register is
             this" once the heading has scrolled past. */
          <li className="-mx-4 mt-2 bg-[var(--color-surface-muted)] px-4 py-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">
              <Bi
                t={T.classHeading(
                  student.classLabel,
                  group.filter((row) => row.classLabel === student.classLabel)
                    .length,
                )}
              />
            </h3>
          </li>
        ) : null}
        <StudentRow
          student={student}
          showClass={spansClasses}
      fields={fields}
      state={rows[student.studentId]!}
      // Within the group she is looking at, not across both: the blanks and the
      // known rows are two separate runs down the screen, and the row "above"
      // only means anything inside one of them.
      //
      // Built only over the fields that can actually carry a value down, and
      // skipped outright when there are none — StudentRow reads a missing key
      // as null, which is what suggestForRow returned for those fields anyway.
      suggestions={
        carryFields.length === 0
          ? NO_SUGGESTIONS
          : Object.fromEntries(
              carryFields.map((field) => [
                field.key,
                suggestForRow(field, group, index, rows),
              ]),
            )
      }
      blank={blankIds.has(student.studentId)}
      // NO_REQUIRED rather than a fresh [] — every student is in the map, so
      // the fallback never fires, but a literal here would be a new array on
      // every render and a changed prop for a row nothing happened to.
      required={requiredByStudent.get(student.studentId) ?? NO_REQUIRED}
      sent={sentIds.has(student.studentId)}
      position={(blankIds.has(student.studentId) ? 0 : blanks.length) + index + 1}
      active={activeStudentId === student.studentId}
      {...handlers.get(student.studentId)!}
        />
      </Fragment>
    );
  };

  if (stage === "review" && summary) {
    return (
      <ReviewSummary
        summary={summary}
        total={roster.length}
        pending={unsent.length}
        sent={sentIds.size}
        busy={busy}
        online={online}
        error={error}
        onFix={fix}
        onBack={closeReview}
        onSend={() => void flush({ manual: true })}
      />
    );
  }

  // The provider wraps the LIST, not the review screen — the review screen has
  // no camera on it, and a queue draining behind a screen she is reading would
  // move numbers under her eyes. It is mounted for the whole time the list is,
  // which is what lets a photo queued on row 40 upload while she is on row 8.
  return (
    <PhotoProvider
      token={token}
      online={online}
      onUploaded={onPhotoUploaded}
    >
      <section
        aria-label="How to complete this list"
        className="-mx-4 grid grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] border-b border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-[var(--color-confirm-fg)]"
      >
        <div className="flex min-w-0 items-start gap-3 border-r border-[var(--color-confirm-border)] pr-3">
          <CheckCircle
            aria-hidden
            size={28}
            weight="duotone"
            className="mt-0.5 shrink-0"
          />
          <p className="min-w-0 text-sm font-semibold leading-snug">
            <Bi
              t={
                blanks.length > 0
                  ? T.fillMissingFirst(blanks.length)
                  : T.checkExistingFirst(known.length)
              }
            />
          </p>
        </div>
        <div className="flex min-w-0 items-start gap-2 pl-3">
          <CloudCheck
            aria-hidden
            size={28}
            weight="duotone"
            className="mt-0.5 shrink-0"
          />
          <p className="min-w-0 text-sm font-medium leading-snug">
            <Bi t={T.savedAutomatically} />
          </p>
        </div>
      </section>

      {/*
       * The banner takes her back to where she stopped.
       *
       * It used to say "carry on from there" and then leave her at the top of
       * forty-six rows to find the place herself. `activeStudentId` is already
       * exactly that place — the first row still editing or partial, else the
       * first unfinished one — and the focusId effect below already knows how
       * to centre a row. Both existed; neither was wired to this.
       *
       * A BUTTON SHE TAPS, NEVER AN AUTOMATIC JUMP. focus.ts states the rule:
       * anything scrolling itself into view while she reads is the screen
       * taking over. A page that threw her down the list on load would also
       * fight keepInView's settle timer. One deliberate 48px tap, and nothing
       * at all happens if she would rather scroll.
       */}
      {restored ? (
        activeStudentId ? (
          <button
            type="button"
            onClick={() => setFocusId(activeStudentId)}
            className="mt-4 flex min-h-[var(--tap-min)] w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-3 text-left text-sm text-[var(--color-correct-fg)] transition-transform active:scale-[0.99]"
          >
            <span className="min-w-0">
              <Bi t={T.restored} />
            </span>
            {/* Bi's Hindi half is a block span, so it needs a plain wrapper —
                as a direct flex item it would sit beside the English. */}
            <span className="flex shrink-0 items-center gap-1 font-semibold">
              <span>
                <Bi t={T.continueHere} />
              </span>
              <CaretRight aria-hidden size={18} weight="bold" />
            </span>
          </button>
        ) : (
          <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-3 text-sm text-[var(--color-correct-fg)]">
            <Bi t={T.restored} />
          </p>
        )
      ) : null}

      {!online ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-absent-border)] bg-[var(--color-absent-bg)] px-4 py-3 text-sm text-[var(--color-absent-fg)]">
          <Bi t={T.offlineWorking} />
        </p>
      ) : null}

      {/* ============================================ 1. the ones that matter */}
      {/* No blanks, no heading. An empty section with a zero in it is noise. */}
      {blanks.length > 0 ? (
        <section>
          <h2 className="sr-only">
            <Bi t={T.blanksHeading(blanks.length)} />
          </h2>
          <ol>{blanks.map(renderRow)}</ol>
        </section>
      ) : null}

      {/* ==================================== 2. the ones already on record */}
      {known.length > 0 ? (
        <section className="mt-5 border-t border-[var(--color-border)] pt-5">
          <h2 className="text-base font-semibold">
            <Bi t={T.knownHeadingShort(known.length)} />
          </h2>

          {/* Hidden entirely on a photo round. "All correct" is one tap
              asserting that forty faces are the right forty children, and
              nobody has looked at them — which is a worse thing to have in the
              master record than no confirmation at all. Every other kind of
              field keeps the button; a photo request simply does not offer it,
              and the sentence under the heading says why. */}
          {untouchedKnown.length > 0 && !hasPhotoField ? (
            <button
              type="button"
              onClick={confirmAllKnown}
              className="mt-3 min-h-14 w-full rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-2 font-semibold text-[var(--color-confirm-fg)] transition-transform active:scale-[0.98]"
            >
              <Bi t={T.confirmAll(untouchedKnown.length)} />
            </button>
          ) : null}

          {hasPhotoField ? (
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
              <Bi t={T.photoNoBulkConfirm} />
            </p>
          ) : null}

          <ol className="mt-3 border-t border-[var(--color-border)]">
            {known.map(renderRow)}
          </ol>
        </section>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          <Bi t={error} />
        </p>
      ) : null}

      {/* Finishing is now something she does, not something that happens to
          her. With auto-send there is no submit to hang a redirect off, and
          yanking her out of the list mid-scroll because a counter hit the
          roster size would be worse than no ending at all. */}
      {done === roster.length && unsent.length === 0 && roster.length > 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border-2 border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] p-4 text-center">
          <p className="font-semibold text-[var(--color-confirm-fg)]">
            <Bi t={T.everyoneSent(roster.length)} />
          </p>
          <button
            type="button"
            onClick={() => {
              clearDraft(token);
              router.push(`/r/${token}/done`);
            }}
            className="mt-3 min-h-12 w-full rounded-[var(--radius-control)] bg-[var(--color-confirm-fg)] px-4 py-2 font-semibold text-white transition-transform active:scale-[0.98]"
          >
            <Bi t={T.finish} />
          </button>
        </div>
      ) : null}

      <ProgressRail
        remaining={roster.length - done}
        total={roster.length}
        reviewable={reviewable}
        pending={unsent.length}
        sent={sentIds.size}
        busy={busy}
        online={online}
        onReview={openReview}
      />
    </PhotoProvider>
  );
}

