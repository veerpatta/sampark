"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StudentRow } from "./StudentRow";
import { ProgressRail } from "./ProgressRail";
import { toHindiDigits } from "./digits";
import {
  clearDraft,
  loadDraft,
  newIdempotencyKey,
  saveDraft,
} from "./draft";
import {
  ANSWERED,
  type RowState,
  type TeacherField,
  type TeacherRosterRow,
} from "./types";

/**
 * The teacher's whole screen.
 *
 * State lives here rather than in each row so the progress rail can count, so
 * there is one object to persist to the phone, and one place to replay from
 * when signal comes back.
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
 */
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

  // Marks are collected, not verified — there is nothing to confirm when the
  // school holds nothing, so those rows show their inputs straight away.
  const collectMode = fields.every((field) => field.mode === "collect");

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

  const submit = useCallback(
    async (auto = false) => {
      const pending = roster.filter(
        (student) =>
          ANSWERED.includes(rows[student.studentId]!.status) &&
          !sentIds.has(student.studentId),
      );
      if (pending.length === 0 || busy) return;

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
        }
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

      <p className="mt-4 px-1 text-sm text-[var(--color-ink-muted)]">
        कुल {toHindiDigits(roster.length)} विद्यार्थी
        {sentIds.size > 0 ? (
          <span className="ml-2 text-[var(--color-confirm-fg)]">
            · {toHindiDigits(sentIds.size)} विद्यालय पहुँच गए
          </span>
        ) : null}
      </p>

      <ol className="mt-2 space-y-3">
        {roster.map((student) => (
          <StudentRow
            key={student.studentId}
            student={student}
            fields={fields}
            state={rows[student.studentId]!}
            collectMode={collectMode}
            sent={sentIds.has(student.studentId)}
            onConfirm={() => update(student.studentId, { status: "confirmed" })}
            onEdit={() => update(student.studentId, { status: "editing" })}
            onAbsent={() =>
              update(student.studentId, { status: "absent", values: {} })
            }
            onDone={() => update(student.studentId, { status: "edited" })}
            onReopen={() => update(student.studentId, { status: "todo" })}
            onChange={(fieldKey, value) =>
              update(student.studentId, {
                status: "editing",
                values: { ...rows[student.studentId]!.values, [fieldKey]: value },
              })
            }
          />
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-danger)] bg-red-50 px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <ProgressRail
        done={done}
        total={roster.length}
        pending={unsent.length}
        busy={busy}
        online={online}
        onSubmit={() => void submit(false)}
      />
    </>
  );
}
