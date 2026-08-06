"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "./draft";
import {
  ANSWERED,
  isBlankRow,
  type RowState,
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
 * point of showing it is that she can put the phone down and trust it.
 *
 * SEND IS BEHIND A REVIEW SCREEN. `stage` is "list" or "review", and the send
 * button exists only in the second one, so she cannot submit without having
 * seen what she is submitting. It is a stage rather than a route on purpose:
 * everything the summary needs is already in this component's state, and a
 * second route would mean another no-store round trip on a bad signal, a
 * remount on every "jump back and fix", and the online listener below either
 * duplicated or dropped exactly when she is standing still and signal returns.
 */

type Stage = "list" | "review";

/** Rows revealed at a time. Ten is a batch she can see the end of. */
const BATCH = 10;

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

  // Blanks first. Order within each group is the name order the server sent.
  const { blanks, known, blankIds } = useMemo(() => {
    const blanks: TeacherRosterRow[] = [];
    const known: TeacherRosterRow[] = [];
    for (const student of roster) {
      (isBlankRow(student, fields) ? blanks : known).push(student);
    }
    return {
      blanks,
      known,
      blankIds: new Set(blanks.map((student) => student.studentId)),
    };
  }, [roster, fields]);

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
  const [error, setError] = useState<string | null>(null);
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
   * How many rows of each group are on screen. Forty-six cards in one scroll is
   * a wall with no end in sight; ten is a batch a person can finish.
   */
  const [shownBlanks, setShownBlanks] = useState(BATCH);
  const [shownKnown, setShownKnown] = useState(BATCH);

  // Held across a failed send so the retry is the SAME batch, not a second one.
  const batchKey = useRef<string | null>(null);

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
      batchKey.current = draft.idempotencyKey;
    }
    setOnline(navigator.onLine);
  }, [token, roster]);

  /* --------------------------------------------------- save as she types */
  useEffect(() => {
    saveDraft(token, {
      rows,
      sent: [...sentIds],
      idempotencyKey: batchKey.current,
    });
  }, [token, rows, sentIds]);

  const done = useMemo(
    () => Object.values(rows).filter((row) => ANSWERED.includes(row.status)).length,
    [rows],
  );

  const unsent = useMemo(
    () =>
      roster.filter(
        (student) =>
          ANSWERED.includes(rows[student.studentId]!.status) &&
          !sentIds.has(student.studentId),
      ),
    [roster, rows, sentIds],
  );

  /** Known-group students she has not touched yet — what "सब सही हैं" covers. */
  const untouchedKnown = useMemo(
    () => known.filter((student) => rows[student.studentId]!.status === "todo"),
    [known, rows],
  );

  function update(studentId: string, patch: Partial<RowState>) {
    setRows((current) => ({
      ...current,
      [studentId]: { ...current[studentId]!, ...patch },
    }));
    // Touching a row again un-sends it, so a correction after a send is not
    // silently dropped.
    setSentIds((current) => {
      if (!current.has(studentId)) return current;
      const next = new Set(current);
      next.delete(studentId);
      return next;
    });
  }

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

    setRows((current) => {
      const next = { ...current };
      for (const student of untouchedKnown) {
        next[student.studentId] = { status: "confirmed", values: {} };
      }
      return next;
    });

    // One tick for the whole action, not one per student. Forty buzzes from a
    // single tap would read as a fault, not as feedback.
    tick();

    // Ten seconds to take it back. The only thing worse than forty taps is
    // forty taps undone one at a time. This used to be an inline strip that
    // pushed the list down as it appeared and again as it went; the toast sits
    // over the list instead, at the bottom, next to her thumb.
    toast({
      message: `${untouchedKnown.length} पर सही का निशान लगाया`,
      undoLabel: "वापस लें",
      duration: 10_000,
      tone: "success",
      undo: () => setRows((current) => ({ ...current, ...before })),
    });
  }


  const summary = useMemo(
    () => summarise(roster, fields, rows),
    [roster, fields, rows],
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
    function onPop() {
      setStage("list");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stage]);

  /** Jump back from the summary to one row, opened and in view. */
  function fix(studentId: string) {
    // The row may be past the batch currently revealed, in which case there is
    // nothing to scroll to. Reveal down to it first.
    const inBlanks = blanks.findIndex((s) => s.studentId === studentId);
    if (inBlanks >= 0) {
      setShownBlanks((current) => Math.max(current, inBlanks + 1));
    } else {
      const inKnown = known.findIndex((s) => s.studentId === studentId);
      if (inKnown >= 0) setShownKnown((current) => Math.max(current, inKnown + 1));
    }

    setStage("list");
    setFocusId(studentId);
    update(studentId, { status: "editing" });
  }

  /**
   * Reveal the next batch as soon as the current one is finished.
   *
   * She gets the "I finished a batch" beat without having to ask for more, and
   * the button below stays for when she wants to skip ahead. Appending rather
   * than paging: her answers are keyed by student id either way, but hiding
   * rows she has already done would make the group heading's count read as a
   * lie, and it would lose her scroll position every ten rows.
   */
  useEffect(() => {
    const batchDone = (group: TeacherRosterRow[], shown: number) =>
      shown < group.length &&
      group
        .slice(0, shown)
        .every((student) => ANSWERED.includes(rows[student.studentId]!.status));

    if (batchDone(blanks, shownBlanks)) {
      setShownBlanks((current) => Math.min(current + BATCH, blanks.length));
    }
    if (batchDone(known, shownKnown)) {
      setShownKnown((current) => Math.min(current + BATCH, known.length));
    }
  }, [rows, blanks, known, shownBlanks, shownKnown]);

  useEffect(() => {
    if (stage !== "list" || !focusId) return;
    const element = document.getElementById(`student-${focusId}`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFocusId(null);
  }, [stage, focusId]);

  const submit = useCallback(
    async (auto = false) => {
      const pending = roster.filter(
        (student) =>
          ANSWERED.includes(rows[student.studentId]!.status) &&
          !sentIds.has(student.studentId),
      );
      if (pending.length === 0 || busy) return;

      // THE REVIEW GATE.
      //
      // An automatic retry may only replay a batch she has ALREADY reviewed and
      // sent. A live batch key means exactly that: it is minted below when a
      // send starts and cleared on success, so a non-null key is a send that
      // left this screen and did not land. Without this check, coming back
      // online would post everything answered-but-unsent straight past the
      // review screen, and the promise that she has seen what she sends would
      // be false.
      if (auto && batchKey.current === null) return;

      setBusy(true);
      if (!auto) setError(null);

      // One key for this batch, reused if the send fails and she taps again.
      batchKey.current ??= newIdempotencyKey();

      const payload = pending.map((student) => {
        const row = rows[student.studentId]!;
        return {
          studentId: student.studentId,
          notPresent: row.status === "absent",
          values: row.status === "absent" ? {} : row.values,
        };
      });

      try {
        const response = await fetch(`/api/r/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            students: payload,
            idempotencyKey: batchKey.current,
          }),
        });

        if (response.status === 404) {
          setError("यह लिंक अब काम नहीं कर रहा। कार्यालय से संपर्क करें।");
          return;
        }
        if (response.status === 429) {
          setError("थोड़ा रुककर फिर भेजें।");
          return;
        }
        if (response.status === 422) {
          setError("कुछ जानकारी सही नहीं है। लाल निशान वाली पंक्तियाँ देखें।");
          return;
        }
        if (!response.ok) {
          setError("भेजने में दिक्कत हुई। थोड़ी देर बाद फिर कोशिश करें।");
          return;
        }

        batchKey.current = null;
        const justSent = new Set([
          ...sentIds,
          ...pending.map((student) => student.studentId),
        ]);
        setSentIds(justSent);
        setError(null);

        if (justSent.size === roster.length) {
          clearDraft(token);
          router.push(`/r/${token}/done`);
          return;
        }

        // Some landed but the roster is not finished — the remaining work is
        // back on the list, so that is where she goes.
        setStage("list");
      } catch {
        // No signal. The draft is already on the phone and the batch key is
        // kept, so the retry below replays the same batch rather than a new one.
        setError(
          auto
            ? null
            : "इंटरनेट नहीं मिल रहा। आपका काम फ़ोन में सुरक्षित है — जुड़ते ही अपने आप चला जाएगा।",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, roster, rows, sentIds, token, router],
  );

  /* --------------------------------------- retry the moment signal returns */
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      void submit(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [submit]);

  const renderRow = (student: TeacherRosterRow) => (
    <StudentRow
      key={student.studentId}
      student={student}
      fields={fields}
      state={rows[student.studentId]!}
      blank={blankIds.has(student.studentId)}
      sent={sentIds.has(student.studentId)}
      onConfirm={() => update(student.studentId, { status: "confirmed" })}
      onEdit={() => update(student.studentId, { status: "editing" })}
      onAbsent={() => update(student.studentId, { status: "absent", values: {} })}
      onDone={() => update(student.studentId, { status: "edited" })}
      onReopen={() => update(student.studentId, { status: "todo" })}
      onChange={(fieldKey, value) =>
        update(student.studentId, {
          status: "editing",
          values: { ...rows[student.studentId]!.values, [fieldKey]: value },
        })
      }
    />
  );

  if (stage === "review") {
    return (
      <ReviewSummary
        summary={summary}
        total={roster.length}
        busy={busy}
        online={online}
        error={error}
        onFix={fix}
        onBack={closeReview}
        onSend={() => void submit(false)}
      />
    );
  }

  return (
    <>
      {restored ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-3 text-sm text-[var(--color-correct-fg)]">
          आपका पहले का काम फ़ोन में सुरक्षित था — वहीं से आगे बढ़ें।
        </p>
      ) : null}

      {!online ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-absent-border)] bg-[var(--color-absent-bg)] px-4 py-3 text-sm text-[var(--color-absent-fg)]">
          इंटरनेट नहीं है। काम करती रहें — सब फ़ोन में सुरक्षित है और जुड़ते ही
          अपने आप भेज दिया जाएगा।
        </p>
      ) : null}

      {/* ============================================ 1. the ones that matter */}
      {/* No blanks, no heading. An empty section with a zero in it is noise. */}
      {blanks.length > 0 ? (
        <section className="mt-5">
          <h2 className="px-1 text-base font-semibold text-[var(--color-warning-fg)]">
            {blanks.length} बच्चों की जानकारी नहीं है — ये सबसे
            ज़रूरी हैं
          </h2>
          <ol className="mt-2 space-y-3">
            {blanks.slice(0, shownBlanks).map(renderRow)}
          </ol>
          <MoreButton
            shown={shownBlanks}
            total={blanks.length}
            onMore={() =>
              setShownBlanks((current) =>
                Math.min(current + BATCH, blanks.length),
              )
            }
          />
        </section>
      ) : null}

      {/* ==================================== 2. the ones already on record */}
      {known.length > 0 ? (
        <section className="mt-7">
          <h2 className="px-1 text-base font-semibold">
            {known.length} बच्चों की जानकारी पहले से है — देखकर
            बता दें कि सही है
          </h2>

          {untouchedKnown.length > 0 ? (
            <button
              type="button"
              onClick={confirmAllKnown}
              className="mt-2 min-h-12 w-full rounded-lg border-2 border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 font-semibold text-[var(--color-confirm-fg)]"
            >
              सब सही हैं ({untouchedKnown.length})
            </button>
          ) : null}

          <ol className="mt-3 space-y-3">
            {known.slice(0, shownKnown).map(renderRow)}
          </ol>
          <MoreButton
            shown={shownKnown}
            total={known.length}
            onMore={() =>
              setShownKnown((current) => Math.min(current + BATCH, known.length))
            }
          />
        </section>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-danger)] bg-red-50 px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <ProgressRail
        remaining={roster.length - done}
        total={roster.length}
        pending={unsent.length}
        sent={sentIds.size}
        busy={busy}
        online={online}
        onReview={openReview}
      />
    </>
  );
}

/**
 * "Next 10 (14 left)".
 *
 * Says how many remain rather than just offering more, because the number is
 * the thing that tells her whether to keep going or put the phone down. Absent
 * once everything in the group is on screen — a disabled button at the end of a
 * list is a dead end she has to read.
 */
function MoreButton({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  const left = total - shown;
  return (
    <button
      type="button"
      onClick={onMore}
      className="mt-3 min-h-12 w-full rounded-lg border-2 border-dashed border-[var(--color-border)] px-4 font-medium text-[var(--color-ink-muted)]"
    >
      अगले {Math.min(BATCH, left)} दिखाएँ — {left} और बाकी
    </button>
  );
}
