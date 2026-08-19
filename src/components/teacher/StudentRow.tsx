"use client";

import { memo, useRef, useState } from "react";
import {
  CaretRight,
  CheckCircle,
  DeviceMobile,
  XCircle,
} from "@phosphor-icons/react";
import { validateField } from "@/lib/fields";
import { titleCaseName } from "@/lib/classes";
import { houseOf } from "@/lib/houses";
import { normalisePhone, PHONE_LENGTH } from "@/lib/phone";
import { HouseChip } from "@/components/HouseChip";
import { tick } from "./haptics";
import {
  judgeRow,
  missingRequired,
  rowTouched,
  soleMatch,
  terminal,
} from "./autosave";
import { COMPLETE, UPLOADABLE } from "./types";
import { Bi } from "./Bi";
import { TEACHER_INPUT, focusNext, keepInView, nextInput } from "./focus";
import { PhotoField } from "./PhotoField";
import { PhotoThumb } from "./PhotoThumb";
import { T } from "./strings";

import type { RowState, TeacherField, TeacherRosterRow } from "./types";

/**
 * One student, and what a teacher can say about them.
 *
 *   Correct   — what you have is right. One tap, and that is the common case.
 *   Change    — it is wrong, let me fix it.
 *
 * There used to be a third: "this child is not in my class". It was removed —
 * a full-width button under every card, on the path her thumb travels, that
 * blanked the row when it was hit by accident. The `not_present` action it
 * wrote still exists everywhere else, because answers given before this change
 * are in the database and still have to read correctly.
 *
 * The whole product rests on Correct being one tap. Anything that adds a step to
 * the confirm path turns a five-minute job back into a forty-minute one — which
 * is also why most confirmations now happen in bulk, one tap for the whole
 * group, and never reach this component at all.
 *
 * A BLANK row — one where the school holds nothing — skips the confirm step
 * entirely and opens its inputs straight away. There is nothing to confirm, so
 * asking for a tap to reveal a keyboard is a tap spent on nothing.
 *
 * A PARTIAL row — one where she answered some of what was asked and a box the
 * school holds nothing for is still empty — STAYS OPEN. This is the fix for the
 * bug that closed it: the card used to collapse into a read-only list a second
 * after the first box was filled, so the empty one was never seen again by her
 * or by anyone. The only thing that will fill that box is her, looking at it.
 *
 * MEMOISED, AND THE STATE STAYS IN RequestForm.
 *
 * A Class 8 link is forty-six of these; a subject link is eighty-four. All the
 * answers live in one object one level up — deliberately, so there is one thing
 * to persist to the phone and one place to replay from — which meant a single
 * digit typed into any row re-rendered every row on the screen. Each of those
 * re-ran rowTouched, missingRequired and judgeRow, and judgeRow calls
 * validateField once per entered field; the open ones rebuilt a whole
 * FieldInput, which validates again. On the cheap Android this is written for
 * that is a visible lag on the tenth digit of the tenth child.
 *
 * The fix is NOT to move state down here. It is that every prop below is now
 * stable unless it genuinely changed: `state` is a fresh object only for the
 * row that was edited, the six callbacks come from a map keyed on the roster,
 * and `suggestions` is a shared frozen object on the rounds that have none.
 * Adding a prop that is rebuilt on every render — an inline arrow, an object
 * literal, a `?? []` — silently switches all of this back off.
 */
export const StudentRow = memo(function StudentRow({
  token,
  student,
  fields,
  state,
  blank,
  required,
  sent,
  position,
  active,
  showClass,
  onConfirm,
  onEdit,
  onChange,
  onLeave,
  onFilledLast,
  onReopen,
  suggestions,
}: {
  /** For reading a photograph back. A plain string, so the memo is unaffected. */
  token: string;
  student: TeacherRosterRow;
  fields: TeacherField[];
  state: RowState;
  /** Carry-down values from the row above, keyed by field. */
  suggestions: Record<string, string | null>;
  /** The school holds nothing for this student — inputs open immediately. */
  blank: boolean;
  /** Field keys the school holds nothing for. See requiredKeys in types.ts. */
  required: string[];
  sent: boolean;
  /** Position in the blanks-first list, shown as a stable visual anchor. */
  position: number;
  /** The first unfinished student receives the only emphasized surface. */
  active: boolean;
  /**
   * Name the child's class on the row.
   *
   * True only when the link carries more than one — a subject link merges a
   * teacher's classes into one list. On a class link the header already says it
   * and repeating it under every name is noise.
   */
  showClass: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onChange: (fieldKey: string, value: string) => void;
  /** Focus left the row entirely — commit now rather than waiting out the timer. */
  onLeave: () => void;
  /** The last field reached a complete value. Nothing more to wait for. */
  onFilledLast: () => void;
  onReopen: () => void;
}) {
  // Every answer gets one tick. Wrapped here rather than at each call site so
  // no future action can quietly ship without the feedback.
  const answer = (fn: () => void) => () => {
    tick();
    fn();
  };

  // Partial keeps the inputs on screen. showEntered stays tied to `edited`, so
  // the read-only summary below is unreachable for a partial row and cannot
  // hide the box that is still empty.
  /*
   * A BLANK ROW IS OPEN. Always, from the moment the list renders, and not
   * because it is the one the screen has decided she is on.
   *
   * It was gated on `active` for a while, so every child except one sat closed
   * behind a tap that revealed a box. That tap buys nothing: there is nothing
   * to confirm on a row the school holds no value for, so the only thing the
   * extra step can produce is the box she was always going to have to fill. On
   * a forty-six child photo round it is forty-five taps and forty-five waits
   * for a card to expand, which is most of the time the round takes.
   */
  const open =
    state.status === "editing" ||
    state.status === "partial" ||
    (blank && state.status === "todo");
  const showStored = state.status === "todo" && !blank;
  const showEntered = state.status === "edited";

  // Two different questions, and a partial row answers them differently:
  // its work HAS gone to the school, and it is NOT finished.
  const uploaded = UPLOADABLE.includes(state.status);
  const collapsed = COMPLETE.includes(state.status);

  const touched = rowTouched(state);
  const missing = missingRequired(state, required);
  const verdict = judgeRow(fields, state, required);

  /*
   * WHAT A TAP ON THE CARD DOES.
   *
   * One thing only: reopen a row she has already answered. There is no longer
   * an expand step to tap into — a blank row arrives open — so the only closed
   * card left on the screen is a finished one, and the only thing anybody wants
   * from a finished card is another look at it.
   *
   * A row the school HOLDS values for is deliberately left alone. Its two
   * actions — Correct and Change — are equally valid, and a card-wide tap would
   * have to guess between them; guessing "Correct" would file an answer nobody
   * gave, and guessing "Change" would throw up a keyboard mid-scroll. Two named
   * buttons filling the width are already the clearest thing on that card.
   */
  const cardAction = collapsed ? onReopen : null;
  const siblingField = fields.find(
    (field) =>
      field.exactLen === PHONE_LENGTH && !student.values[field.key],
  );
  const siblingValue = siblingField
    ? (state.values[siblingField.key] ?? student.values[siblingField.key] ?? "")
    : "";

  return (
    <li
      // The anchor the review screen scrolls back to when she taps a change.
      id={`student-${student.studentId}`}
      // Leaving the row is her saying she is finished with it, so it commits
      // without waiting out the timer. relatedTarget tells us whether focus
      // went somewhere else inside this same row, which is not leaving.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onLeave();
        }
      }}
      // Rows now read as one checklist rather than a stack of nested cards.
      // The active student keeps the only emphasized divider treatment; its
      // numbered badge, readable status, and focused input carry state without
      // relying on colour alone. The global reduced-motion rule still governs
      // this short surface transition.
      className={`scroll-mt-28 border-b px-0 py-5 transition-colors duration-200 ${
        active
          ? "-mx-4 border-y border-[var(--color-brand-100)] bg-[var(--color-surface)] px-4"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <Header
        action={cardAction}
        label={`${T.lookAgain.en}: ${titleCaseName(student.name)}`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
              active
                ? "bg-[var(--color-brand-600)] text-white shadow-[var(--shadow-badge)]"
                : "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]"
            }`}
          >
            {position}
          </span>
          <div className="min-w-0">
          {/* Stored ALL CAPS, rendered title case. A screen shouting a child's
              name reads as an error message. */}
            <span className="text-name font-semibold">{titleCaseName(student.name)}</span>
            <Recognition
              student={student}
              fields={fields}
              showClass={showClass}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Two facts, never collapsed into one tick.
              With nothing to press, there is no moment that means "handed
              over", so the row has to carry it: grey while it is only on the
              phone, green once the school actually has it. On a bad signal the
              difference is the whole truth. */}
          {/* English only, and only here. These are compact chips in the row
              that has to stay scannable, the state is already carried by the
              card's colour and its left bar, and the same words appear in full
              — with their Hindi — on the rail and on the receipt. A two-line
              chip beside a child's name costs more than it says. */}
          {uploaded && !open ? (
            sent ? (
              <span className="flex items-center gap-1 rounded bg-[var(--color-confirm-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-confirm-fg)]">
                <CheckCircle aria-hidden size={14} weight="fill" />
                {T.reachedSchool.en}
              </span>
            ) : (
              <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-xs text-[var(--color-ink-muted)]">
                {T.savedOnPhone.en}
              </span>
            )
          ) : null}
          {state.status === "confirmed" ? (
            <CheckCircle
              aria-label={T.correct.en}
              size={24}
              weight="fill"
              className="text-[var(--color-confirm-fg)]"
            />
          ) : null}
          {/* The word is the colour-blind channel, and it is also the only
              thing that says "sent AND still not done" in one breath. */}
          {state.status === "partial" && !open ? (
            <span className="text-sm font-medium text-[var(--color-partial-fg)]">
              {T.statusPartial.en}
            </span>
          ) : null}
          {state.status === "edited" ? (
            <span className="text-sm font-medium text-[var(--color-correct-fg)]">
              {T.statusChanged.en}
            </span>
          ) : null}
          {state.status === "absent" ? (
            <span className="text-sm font-medium text-[var(--color-absent-fg)]">
              {T.statusAbsent.en}
            </span>
          ) : null}
          {blank && missing.length > 0 ? (
            <span className="rounded-xl bg-[var(--color-correct-bg)] px-2.5 py-1 text-center text-sm font-medium text-[var(--color-correct-fg)]">
              <Bi t={T.missingCount(missing.length)} />
            </span>
          ) : null}
        </div>
      </Header>

      {/* ------------------------------------------- what the school holds now */}
      {showStored ? (
        <dl className="ml-[52px] mt-3 space-y-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2"
            >
              <dt className="text-sm text-[var(--color-ink-muted)]">
                <Bi t={label(field)} />
              </dt>
              <dd className="text-right text-base font-medium">
                <Value
                  token={token}
                  field={field}
                  value={student.values[field.key]}
                  name={student.name}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* ------------------------------------------------- what she just typed */}
      {showEntered ? (
        <dl className="ml-[52px] mt-3 space-y-2">
          {fields.map((field) => {
            const entered = state.values[field.key];
            const stored = student.values[field.key];
            const changed = entered !== undefined && entered !== "" && entered !== stored;
            return (
              <div
                key={field.key}
                className="flex items-baseline justify-between gap-3 border-t border-[var(--color-correct-border)] pt-2"
              >
                <dt className="text-sm text-[var(--color-ink-muted)]">
                  <Bi t={label(field)} />
                </dt>
                <dd className="flex items-center justify-end gap-2 text-right text-base font-medium">
                  {changed ? (
                    <>
                      {stored ? (
                        <span className="opacity-50">
                          <Value
                            token={token}
                            field={field}
                            value={stored}
                            name={student.name}
                            struck
                          />
                        </span>
                      ) : null}
                      <Value
                        token={token}
                        field={field}
                        value={entered}
                        name={student.name}
                      />
                    </>
                  ) : (
                    <Value
                      token={token}
                      field={field}
                      value={stored ?? null}
                      name={student.name}
                    />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {/* --------------------------------------------------------- the inputs */}
      {open ? (
        <div className="ml-[52px] mt-4 space-y-4">
          {fields.map((field, index) =>
            // A photo is not a box she types in, so it does not go through
            // FieldInput's keyboard machinery at all — no auto-advance, no
            // length counter, no carry-down suggestion. It owns its own upload
            // and writes into the row only once the school has the bytes.
            field.inputType === "photo" ? (
              <PhotoField
                key={field.key}
                studentId={student.studentId}
                studentName={titleCaseName(student.name)}
                value={
                  state.values[field.key] ?? student.values[field.key] ?? ""
                }
                missing={
                  state.status === "partial" && missing.includes(field.key)
                }
              />
            ) : (
            <FieldInput
              key={field.key}
              field={field}
              value={state.values[field.key] ?? student.values[field.key] ?? ""}
              onChange={(value) => onChange(field.key, value)}
              last={index === fields.length - 1}
              // Gated on the row being partial, not merely on the box being
              // empty. Highlighting every unfilled box the moment she starts
              // typing into the first one would be the screen pointing at work
              // she is in the middle of doing.
              missing={state.status === "partial" && missing.includes(field.key)}
              // Auto-advance needs to know where to go next, and the row is the
              // only thing that knows the order.
              suggestion={suggestions[field.key] ?? null}
              onFilled={(from) => {
                /*
                 * A fixed-length field just reached its length, so she is done
                 * with it whether or not she says so. Carry the caret on.
                 *
                 * THE WALK IS OVER MARKED INPUTS, NOT OVER `input`. It used to
                 * query every input inside the card, and a photo field's file
                 * inputs are inputs — sr-only ones, so the moment a round asked
                 * for a photograph as well as a number this focused something
                 * invisible and the keyboard vanished mid-row.
                 */
                const next = nextInput(from);
                const inThisRow =
                  next?.closest("li")?.id ===
                  `student-${student.studentId}`;

                // Never jump onto a field she has already filled — she did not
                // ask to revisit it, and moving the caret there loses her place.
                if (next && inThisRow && next.value === "") {
                  next.focus();
                  keepInView(next);
                  return;
                }

                // Nothing left to type in this row, so there is nothing to wait
                // for either. Commit it now rather than after the timer — and
                // then carry on into the next child, because a class of
                // forty-six is the same ten digits forty-six times and stopping
                // to find the next box is the work this screen exists to remove.
                onFilledLast();

                /*
                 * WHETHER TO MOVE ON IS READ, NOT PREDICTED.
                 *
                 * The obvious test — "is this row's verdict ready?" — is wrong,
                 * and quietly: `verdict` was computed for the render that is
                 * still on screen, so at this instant it describes the row as it
                 * was BEFORE the digit that just landed. It says "unfinished"
                 * for a row that has this moment become finished, and the caret
                 * never moves.
                 *
                 * So wait for the re-render and look. A row that still has a box
                 * in it is partial — a child whose number is in but whose
                 * photograph is not — and she must be left standing in front of
                 * it. A row with no box left has collapsed, and the next child
                 * is where she was going anyway.
                 *
                 * A timeout and NOT requestAnimationFrame. rAF does not run
                 * while the page is not painting, so a phone locked or switched
                 * away from mid-row would hold the callback and then move her
                 * caret whenever she came back — minutes later, into a child she
                 * is no longer looking at.
                 */
                setTimeout(() => {
                  const row = document.getElementById(
                    `student-${student.studentId}`,
                  );
                  if (row?.querySelector(`[${TEACHER_INPUT}]`)) return;
                  if (!next || !next.isConnected) return;
                  next.focus();
                  keepInView(next);
                }, 0);
              }}
            />
            ),
          )}

          {student.siblingPhone && siblingField && !siblingValue ? (
            <SuggestChip
              label={T.siblingNumber(
                student.siblingPhone.name,
                student.siblingPhone.phone,
              )}
              value={student.siblingPhone.phone}
              onUse={(value) => onChange(siblingField.key, value)}
            />
          ) : null}

          {/* A row that is not finished has to say so, and the two reasons it
              might not be are different enough to need different words.

              Partial: everything she typed is fine and has gone to the school,
              and a box is still empty. She needs the count, because "one of
              two" is the fact she cannot see for herself once the card is
              taller than her thumb.

              Unfinished: something is half-typed, so nothing has gone anywhere.
              Otherwise the only signal that a four-digit phone number was never
              counted is its absence from a total she has no reason to be
              adding up. */}
          {verdict === "unfinished" && touched ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              <Bi t={T.notFinished} />
            </p>
          ) : null}
        </div>
      ) : null}

      {/* -------------------------------------------------------- the actions */}
      {(state.status === "todo" && !blank) || collapsed ? (
        <div className="ml-[52px] mt-4">
          <div className="flex flex-wrap items-center gap-2">
          {state.status === "todo" && !blank ? (
            <>
              <button
                type="button"
                onClick={answer(onConfirm)}
                className="min-h-[52px] flex-1 rounded-[var(--radius-control)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-2 font-semibold text-[var(--color-confirm-fg)] transition-transform active:scale-[0.98]"
              >
                <Bi t={T.correct} />
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="min-h-[52px] flex-1 rounded-[var(--radius-control)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-2 font-semibold text-[var(--color-correct-fg)] transition-transform active:scale-[0.98]"
              >
                <Bi t={T.change} />
              </button>
            </>
          ) : null}

          {/* Only a row that has CLOSED needs reopening. A partial row is
              already open with its empty box on screen. */}
          {collapsed ? (
            <button
              type="button"
              onClick={onReopen}
              className="flex min-h-12 w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium text-[var(--color-brand-600)] transition-transform active:scale-[0.98]"
            >
              <Bi t={T.lookAgain} />
              <CaretRight aria-hidden size={22} weight="bold" />
            </button>
          ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
});

/**
 * One field's value, as the thing it actually is.
 *
 * A photograph is a photograph. Every other field is a string, and always was.
 *
 * THIS IS WHERE THE PHOTO USED TO DISAPPEAR. Both read-only summaries printed
 * `values[key]` straight out, so the moment a photo row committed and collapsed
 * — which is one second after the upload lands — her child's face was replaced
 * by `students/S1001/20260819-3f9c….jpg`. Scrolling a list of forty-six for the
 * twelve she had done meant reading pathnames. The office side never had this
 * problem: /review has always rendered a photo submission through PhotoDiff.
 *
 * The branch is on inputType, never on the key being 'photo' — a second photo
 * field added as a row in field_defs works with no deploy. Rule 11.
 */
function Value({
  token,
  field,
  value,
  name,
  struck,
}: {
  token: string;
  field: TeacherField;
  value: string | null | undefined;
  name: string;
  /** The superseded half of a change. Only ever applies to text. */
  struck?: boolean;
}) {
  if (value === null || value === undefined || value === "") {
    return <span>{T.nothingOnRecord.en}</span>;
  }

  if (field.inputType === "photo") {
    return <PhotoThumb token={token} pathname={value} name={name} />;
  }

  return (
    <span
      className={`${numeric(field) ? "font-mono" : ""} ${
        struck ? "text-sm line-through" : ""
      }`}
    >
      {value}
    </span>
  );
}

/**
 * The child's name, badge and status — and, when there is one thing to do, the
 * control that does it.
 *
 * A real <button> rather than an onClick on a div, so it is reachable by
 * keyboard and announces itself, and so the press state comes for free. Where
 * there is nothing unambiguous to do it stays a plain row and the named buttons
 * below the card are the only targets. See cardAction above for which is which.
 */
function Header({
  action,
  label,
  children,
}: {
  action: (() => void) | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!action) {
    return (
      <div className="flex items-start justify-between gap-3">{children}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={action}
      aria-label={label}
      // `text-left` because a button centres its content by default and this
      // one is a row of a checklist, not a label on a control.
      className="flex w-full items-start justify-between gap-3 text-left transition-transform active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

/**
 * Everything we know about this child that is NOT being asked about.
 *
 * The teacher knows these children by face and by nickname, not as a row in a
 * spreadsheet. Every scrap of identifying data makes it faster for her to be
 * sure which child she is answering for, and being sure is the whole product.
 *
 * Three rules keep it from becoming clutter:
 *
 *   1. Read-only and visually recessive. Smaller and muted, never competing
 *      with the input. She is not confirming this; she is using it to recognise
 *      a child.
 *   2. Never repeat a field the request is asking about. Showing the father's
 *      name as context on a form collecting the father's name is noise at best
 *      and a leading answer at worst.
 *   3. Class is in the sticky header, not on every row.
 *
 * The virtuous circle worth knowing about: the more fields get filled, the
 * better every FUTURE request works. A house collected in September makes the
 * January request easier to answer.
 */
function Recognition({
  student,
  fields,
  showClass,
}: {
  student: TeacherRosterRow;
  fields: TeacherField[];
  showClass: boolean;
}) {
  const asked = new Set(fields.map((field) => field.key));
  const house = houseOf(student.house);

  const showRoute = student.route && !asked.has("bus_route");
  const showFather = student.fatherName && !asked.has("father_name");
  const showHouse = house && !asked.has("house");

  const classLabel = showClass ? student.classLabel : null;

  if (!classLabel && !student.srNo && !showRoute && !showFather && !showHouse) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-ink-muted)]">
      {/* English only, on purpose. This line exists so she can tell one child
          from another in a glance; a Hindi second line under each fragment
          would double the height of the very thing that has to be skimmed. */}
      {/* FIRST, and the only thing here that is not just recognition. On a
          subject link this is the register the name came from, and without it
          eighty-four children read as one undifferentiated list. */}
      {classLabel ? (
        <span className="rounded bg-[var(--color-brand-50)] px-1.5 py-0.5 text-xs font-semibold text-[var(--color-brand-700)]">
          {classLabel}
        </span>
      ) : null}

      {student.srNo ? (
        <span className="font-mono text-xs">SR {student.srNo}</span>
      ) : null}

      {showHouse ? <HouseChip house={student.house} /> : null}

      {showFather ? <span>Father: {titleCaseName(student.fatherName!)}</span> : null}
      {showRoute ? <span>{student.route}</span> : null}
    </div>
  );
}

/**
 * A one-tap value she can take or ignore.
 *
 * Always a suggestion, never a prefill. A prefilled value that happens to be
 * wrong gets confirmed by a tired thumb and the office cannot tell the
 * difference afterwards; a value she had to reach for was chosen.
 */
function SuggestChip({
  label,
  value,
  onUse,
}: {
  label: string;
  value: string;
  onUse: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        tick();
        onUse(value);
      }}
      className="mt-3 flex min-h-12 w-full items-center justify-between gap-3 border-t border-[var(--color-border)] px-1 pt-3 text-left text-sm font-medium text-[var(--color-ink)] transition-transform active:scale-[0.98]"
    >
      {/* The label is a value she is reading (a number, a route), so it stays
          as it is; only the instruction attached to it is bilingual. */}
      <span className="min-w-0 text-[var(--color-ink-muted)]">{label}</span>
      <span className="shrink-0 rounded-[var(--radius-control)] border border-[var(--color-brand-500)] px-3 py-2 text-center text-[var(--color-brand-600)]">
        <Bi t={T.useThis} />
      </span>
    </button>
  );
}

/**
 * One field's input.
 *
 * Three things matter here, all of them about not making her give up:
 *
 *   - The number pad is the only keyboard she should ever see for a phone
 *     number, and for a phone number it is the DIALPAD — inputMode="tel", not
 *     "numeric". Both suppress the letters; "numeric" gives Android the
 *     compressed number row along the top, "tel" gives the 3x4 grid, whose keys
 *     are roughly twice the area. A class of forty-six is 460 digit taps, one
 *     handed, and the cheapest thing that can be done about them is to make
 *     each one a bigger target. Aadhaar is also inputType "tel" in the registry
 *     and gets the same pad, which is right for twelve digits too; marks are
 *     "number" and keep the number row. Plus autoComplete="off".
 *   - Non-digits are stripped as she types rather than rejected afterwards, and
 *     a leading +91 or 0 is dropped silently. Do not error on something you can
 *     simply fix.
 *   - No red until the field is full or she leaves it. Validating on the first
 *     keystroke means the screen is scolding her for the nine digits she has
 *     not typed yet.
 */
function FieldInput({
  field,
  value,
  onChange,
  last,
  onFilled,
  suggestion,
  missing,
}: {
  field: TeacherField;
  value: string;
  onChange: (value: string) => void;
  /** Last field in the row, so the keyboard offers Done rather than Next. */
  last: boolean;
  /**
   * This box is finished and she did not have to say so. Carries the control it
   * happened in, which may be a <select> — choosing a house is as final as
   * typing the tenth digit of a number.
   */
  onFilled: (from: HTMLInputElement | HTMLSelectElement) => void;
  /** What the row above answered for this field, when carrying down is safe. */
  suggestion: string | null;
  /** The row settled without this one, and the school holds nothing for it. */
  missing: boolean;
}) {
  const [touched, setTouched] = useState(false);
  /** Was the last interaction with the native select a tap, not an arrow key? */
  const picked = useRef(false);
  const isNumeric = numeric(field);
  const check = validateField(field, value);
  const full = field.exactLen !== null && value.length >= field.exactLen;
  const bad = value !== "" && !check.ok && (touched || full);

  // Never --color-danger for this. An empty box is unfinished, not wrong, and
  // red belongs to "what you typed cannot be right".
  const border = bad
    ? "border-[var(--color-danger)]"
    : missing
      ? "border-[var(--color-partial-border)]"
      : "border-[var(--color-border)]";

  /*
   * Enter moves on rather than doing nothing.
   *
   * preventDefault because the browser's own answer to Enter in a text field is
   * to submit the form it is in, and on a page with no form that is silence —
   * which is exactly what she was getting. `enterKeyHint` has been telling her
   * the key says "next" for a while; this is the half that makes it true.
   */
  const onEnterGoNext = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusNext(event.currentTarget);
  };

  const askFor = missing ? (
    <span className="mt-1 block text-sm font-medium text-[var(--color-partial-fg)]">
      <Bi t={T.stillToFill} />
    </span>
  ) : null;

  // Two buttons, not a checkbox. A checkbox has one visible state and its
  // unticked state is indistinguishable from "nobody has looked at this" — the
  // exact ambiguity the whole review path exists to avoid.
  if (field.inputType === "boolean") {
    return (
      <div>
        <span className="block text-sm font-medium text-[var(--color-ink)]">
          <Bi t={label(field)} />
        </span>
        <div className="mt-1 flex gap-2">
          {[
            { value: "yes", phrase: T.yes },
            { value: "no", phrase: T.no },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                tick();
                onChange(option.value);
              }}
              className={`min-h-[52px] flex-1 rounded-[var(--radius-control)] border px-4 py-2 font-semibold transition-transform active:scale-[0.98] ${
                value === option.value
                  ? "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              <Bi t={option.phrase} />
            </button>
          ))}
        </div>
        {askFor}
      </div>
    );
  }

  if (field.inputType === "select") {
    const options = optionsOf(field);

    // A native select is right for four houses and hostile for twenty-nine bus
    // routes — on Android that is a full-screen wheel she has to scroll through
    // for every child. Above a dozen options, type-to-filter with a datalist is
    // faster and the whitelist still decides what counts as an answer.
    if (options.length > 12) {
      return (
        <label className="block">
          <span className="block text-sm font-medium text-[var(--color-ink)]">
            <Bi t={label(field)} />
          </span>
          <input
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              // Only once nothing on the list can still extend what she has
              // typed. See soleMatch: "Amet" must not carry her away while
              // "Amet Road" is still reachable.
              if (next.length > value.length && soleMatch(options, next)) {
                onFilled(event.currentTarget);
              }
            }}
            onBlur={() => setTouched(true)}
            onFocus={(event) => keepInView(event.currentTarget)}
            onKeyDown={onEnterGoNext}
            {...{ [TEACHER_INPUT]: "" }}
            list={`options-${field.key}`}
            enterKeyHint={last ? "done" : "next"}
            autoComplete="off"
            autoCapitalize="words"
            placeholder={T.typeToSearch}
            className={`mt-2 min-h-14 w-full rounded-[var(--radius-control)] border bg-white px-3 text-base outline-none transition-shadow focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] ${border}`}
          />
          <datalist id={`options-${field.key}`}>
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {suggestion && !value ? (
            <SuggestChip label={T.sameAsLast(suggestion)} onUse={onChange} value={suggestion} />
          ) : null}
          {bad ? (
            <span role="alert" className="mt-1 block text-sm text-[var(--color-danger)]">
              <Bi t={T.chooseFromList} />
            </span>
          ) : (
            askFor
          )}
        </label>
      );
    }

    return (
      <label className="block">
        <span className="block text-sm font-medium text-[var(--color-ink)]">
          <Bi t={label(field)} />
        </span>
        <select
          value={value}
          /*
           * A pick from a native select is a commitment — she chose it off a
           * wheel, there is no half-typed state to wait out, and the reason the
           * fixed-length advance exists ("stopping to find the next box is the
           * work this screen exists to remove") is the same reason here.
           *
           * ONLY WHEN SHE POINTED AT IT. A closed <select> driven by the arrow
           * keys fires `change` on EVERY arrow press, so advancing on any
           * change would throw a keyboard user off the field on the first
           * keystroke, three options before the one they wanted. Touch and
           * mouse open a picker and fire once, on the choice — which is the
           * case this is for. A keyboard still moves on with Enter or Tab.
           */
          onPointerDown={() => {
            picked.current = true;
          }}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            // Not on the empty placeholder: clearing a field is not answering it.
            if (next !== "" && picked.current) {
              picked.current = false;
              onFilled(event.currentTarget);
            }
          }}
          onFocus={(event) => keepInView(event.currentTarget)}
          onKeyDown={(event) => {
            picked.current = false;
            onEnterGoNext(event);
          }}
          {...{ [TEACHER_INPUT]: "" }}
          className={`mt-2 min-h-14 w-full rounded-[var(--radius-control)] border bg-white px-3 text-base outline-none transition-shadow focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] ${border}`}
        >
          {/* An <option> cannot hold two lines, so this one carries both
              languages on one, separated. It is the only string on the surface
              that does. */}
          <option value="">{`${T.chooseOne.en}  ${T.chooseOne.hi}`}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {suggestion && !value ? (
          <SuggestChip label={T.sameAsLast(suggestion)} onUse={onChange} value={suggestion} />
        ) : null}
        {askFor}
      </label>
    );
  }

  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-sm font-medium text-[var(--color-ink)]">
        <span className="min-w-0">
          <Bi t={label(field)} />
        </span>
        {isNumeric && field.exactLen && value.length > 0 ? (
          <span className="font-mono text-xs">
            {value.length} / {field.exactLen}
          </span>
        ) : null}
      </span>
      <div className="relative mt-2">
        <input
          value={value}
          onChange={(event) => {
            const next = clean(field, event.target.value);
            onChange(next);
            // Move on only when the field GREW into a complete value. Doing it on
            // any change would yank the caret away the moment she backspaces to
            // correct the last digit, which is exactly when she needs to stay.
            //
            // "Complete" is terminal()'s call, not a length test — which is what
            // brings the marks round in: a mark out of 25 has no fixed length,
            // but the moment another digit could not be legal it is finished.
            if (next.length > value.length && terminal(field, next)) {
              onFilled(event.currentTarget);
            }
          }}
          onBlur={() => setTouched(true)}
          onFocus={(event) => keepInView(event.currentTarget)}
          onKeyDown={onEnterGoNext}
          {...{ [TEACHER_INPUT]: "" }}
          type={field.inputType === "date" ? "date" : "text"}
          inputMode={
            field.inputType === "tel" ? "tel" : isNumeric ? "numeric" : "text"
          }
          enterKeyHint={last ? "done" : "next"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize={isNumeric ? "off" : "words"}
          placeholder={
            field.inputType === "tel" && field.exactLen
              ? `Enter ${field.exactLen}-digit number`
              : field.key === "father_name"
                ? "Enter father's full name"
                : `Enter ${field.labelEn.toLowerCase()}`
          }
          // No maxLength on a numeric field: it would truncate a pasted
          // "+91 98765 43210" to its first ten CHARACTERS before clean() ever saw
          // it, leaving a mangled number. clean() caps the digits instead.
          maxLength={isNumeric ? undefined : (field.exactLen ?? undefined)}
          className={`min-h-14 w-full rounded-[var(--radius-control)] border bg-white px-3 text-base outline-none transition-shadow placeholder:text-[var(--color-ink-muted)]/80 focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] ${border} ${
            isNumeric ? "font-mono" : ""
          } ${field.inputType === "tel" ? "pr-12" : ""}`}
        />
        {/*
         * ONE SLOT, TWO JOBS, AND NEVER BOTH AT ONCE.
         *
         * Empty box: the phone glyph, which is a hint about what goes here and
         * is worth its 48px only while the box is empty.
         *
         * Filled box: a way to empty it. She taps Change on a row whose number
         * is wrong and the box arrives holding ten digits she does not want —
         * so replacing it costs ten backspaces on a cheap phone, and the budget
         * this whole product is built on is "forty taps and three corrections".
         * Three corrections were costing thirty taps of deleting.
         *
         * Deliberately not offered on Aadhaar, which is also inputType "tel":
         * twelve digits nobody re-types on a whim, and a destructive control
         * beside it is a worse trade than the backspaces.
         */}
        {field.inputType === "tel" && field.exactLen === PHONE_LENGTH && value ? (
          <button
            type="button"
            // Nothing here can be committed or uploaded, so the row's own blur
            // commit must not fire on the way to this button — hence it lives
            // inside the same <li>, which is what onBlur checks for.
            onClick={(event) => {
              tick();
              onChange("");
              // Straight back into the box. Clearing is something she does in
              // order to type, so putting the keyboard away first would cost
              // her the tap it just saved.
              event.currentTarget
                .closest("div")
                ?.querySelector<HTMLInputElement>(`[${TEACHER_INPUT}]`)
                ?.focus();
            }}
            aria-label={T.clearNumber.en}
            className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-[var(--color-ink-muted)] transition-transform active:scale-[0.9]"
          >
            <XCircle aria-hidden size={24} weight="fill" />
          </button>
        ) : field.inputType === "tel" ? (
          <DeviceMobile
            aria-hidden
            size={24}
            weight="regular"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]"
          />
        ) : null}
      </div>
      {!bad && isNumeric && field.exactLen ? (
        <span className="mt-2 block text-sm text-[var(--color-ink-muted)]">
          <Bi t={T.numericHint(field.exactLen)} />
        </span>
      ) : null}

      {!bad ? askFor : null}

      {bad ? (
        <span
          role="alert"
          className="mt-1 block text-sm font-medium text-[var(--color-danger)]"
        >
          {/* validateField has always returned both halves; the teacher surface
              only ever showed the Hindi one. */}
          {check.ok ? null : (
            <Bi t={{ en: check.error, hi: check.errorHi }} />
          )}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Strip what cannot belong, silently.
 *
 * A parent's number arrives on WhatsApp as +91 98765 43210 as often as not, and
 * pasting it should just work. Do not error on something you can simply fix.
 *
 * A ten-digit numeric field IS a phone number here, so it goes through the same
 * lib/phone.ts the request builder and the server use — one definition of what
 * a number is, rather than this one drifting from theirs. Other numeric fields
 * (Aadhaar at twelve digits, marks) just lose their non-digits.
 */
function clean(field: TeacherField, raw: string): string {
  if (!numeric(field)) return raw;
  if (field.exactLen === PHONE_LENGTH) return normalisePhone(raw);

  const digits = raw.replace(/\D/g, "");
  return field.exactLen ? digits.slice(0, field.exactLen) : digits;
}

const numeric = (field: TeacherField) =>
  field.inputType === "tel" || field.inputType === "number";

/**
 * A field's own two labels, as a Phrase.
 *
 * `field_defs` has carried `label_en` and `label_hi` since the first migration;
 * the teacher surface simply never read the English one. This is the whole
 * adapter — there is nothing to translate and nothing to seed.
 */
const label = (field: TeacherField) => ({
  en: field.labelEn,
  hi: field.labelHi,
});

function optionsOf(field: TeacherField): string[] {
  return Array.isArray(field.options) ? field.options.map(String) : [];
}
