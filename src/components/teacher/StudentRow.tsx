"use client";

import { useState } from "react";
import { validateField } from "@/lib/fields";
import { titleCaseName } from "@/lib/classes";
import { houseOf } from "@/lib/houses";
import { normalisePhone, PHONE_LENGTH } from "@/lib/phone";
import { HouseChip } from "@/components/HouseChip";
import { tick } from "./haptics";
import { rowReady, rowTouched } from "./autosave";

import type { RowState, TeacherField, TeacherRosterRow } from "./types";

/**
 * One student, and what a teacher can say about them.
 *
 *   सही है   — what you have is right. One tap, and that is the common case.
 *   बदलें    — it is wrong, let me fix it.
 *   नहीं है  — this child is not in my class.
 *
 * The whole product rests on सही है being one tap. Anything that adds a step to
 * the confirm path turns a five-minute job back into a forty-minute one — which
 * is also why most confirmations now happen in bulk, one tap for the whole
 * group, and never reach this component at all.
 *
 * A BLANK row — one where the school holds nothing — skips the confirm step
 * entirely and opens its inputs straight away. There is nothing to confirm, so
 * asking for a tap to reveal a keyboard is a tap spent on nothing.
 */
export function StudentRow({
  student,
  fields,
  state,
  blank,
  sent,
  onConfirm,
  onEdit,
  onAbsent,
  onChange,
  onLeave,
  onFilledLast,
  onReopen,
  suggestions,
}: {
  student: TeacherRosterRow;
  fields: TeacherField[];
  state: RowState;
  /** Carry-down values from the row above, keyed by field. */
  suggestions: Record<string, string | null>;
  /** The school holds nothing for this student — inputs open immediately. */
  blank: boolean;
  sent: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onAbsent: () => void;
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

  const editing = state.status === "editing" || (blank && state.status === "todo");
  const showStored = state.status === "todo" && !blank;
  const showEntered = state.status === "edited";
  const answered =
    state.status === "confirmed" ||
    state.status === "edited" ||
    state.status === "absent";

  const touched = rowTouched(state);
  const ready = rowReady(fields, state);

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
      // The state colour crossfades over 200ms rather than snapping, which is
      // how the row says "yes, that registered". A plain CSS transition and not
      // Motion on purpose: Motion cannot tween a var(), and the reduced-motion
      // rule in globals.css already neutralises transition-duration, so this
      // honours the OS setting without a second mechanism to remember.
      className={`scroll-mt-24 rounded-[var(--radius-card)] border-2 p-4 transition-colors duration-200 ${
        {
          todo: "border-[var(--color-border)] bg-[var(--color-surface)]",
          editing: "border-[var(--color-correct-border)] bg-[var(--color-surface)]",
          confirmed:
            "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)]",
          edited:
            "border-[var(--color-correct-border)] bg-[var(--color-correct-bg)]",
          absent:
            "border-[var(--color-absent-border)] bg-[var(--color-absent-bg)]",
        }[state.status]
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Stored ALL CAPS, rendered title case. A Hindi-first screen
              shouting a child's name reads as an error message. */}
          <span className="text-name font-medium">{titleCaseName(student.name)}</span>
          <Recognition student={student} fields={fields} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Two facts, never collapsed into one tick.
              With nothing to press, there is no moment that means "handed
              over", so the row has to carry it: grey while it is only on the
              phone, green once the school actually has it. On a bad signal the
              difference is the whole truth. */}
          {answered ? (
            sent ? (
              <span className="rounded bg-[var(--color-confirm-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-confirm-fg)]">
                ✓ विद्यालय पहुँच गया
              </span>
            ) : (
              <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-xs text-[var(--color-ink-muted)]">
                फ़ोन में सुरक्षित
              </span>
            )
          ) : null}
          {state.status === "confirmed" ? (
            <span className="text-2xl text-[var(--color-confirm-fg)]" aria-label="सही है">
              ✓
            </span>
          ) : null}
          {state.status === "edited" ? (
            <span className="text-sm font-medium text-[var(--color-correct-fg)]">
              बदला गया
            </span>
          ) : null}
          {state.status === "absent" ? (
            <span className="text-sm font-medium text-[var(--color-absent-fg)]">
              नहीं है
            </span>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------- what the school holds now */}
      {showStored ? (
        <dl className="mt-3 space-y-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2"
            >
              <dt className="text-sm text-[var(--color-ink-muted)]">
                {field.labelHi}
              </dt>
              <dd className="text-right text-base font-medium">
                <span className={numeric(field) ? "font-mono" : ""}>
                  {student.values[field.key]}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* ------------------------------------------------- what she just typed */}
      {showEntered ? (
        <dl className="mt-3 space-y-2">
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
                  {field.labelHi}
                </dt>
                <dd className="text-right text-base font-medium">
                  {changed ? (
                    <>
                      {stored ? (
                        <span className="mr-2 text-sm line-through opacity-50">
                          {stored}
                        </span>
                      ) : null}
                      <span className={numeric(field) ? "font-mono" : ""}>
                        {entered}
                      </span>
                    </>
                  ) : (
                    <span className={numeric(field) ? "font-mono" : ""}>
                      {stored ?? "खाली है"}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {/* --------------------------------------------------------- the inputs */}
      {editing ? (
        <div className="mt-3 space-y-3">
          {fields.map((field, index) => (
            <FieldInput
              key={field.key}
              field={field}
              value={state.values[field.key] ?? student.values[field.key] ?? ""}
              onChange={(value) => onChange(field.key, value)}
              last={index === fields.length - 1}
              // Auto-advance needs to know where to go next, and the row is the
              // only thing that knows the order.
              suggestion={suggestions[field.key] ?? null}
              // Only on a phone field the school holds nothing for. A child who
              // already has a number is not asking a question.
              sibling={
                field.exactLen === PHONE_LENGTH &&
                !student.values[field.key] &&
                student.siblingPhone
                  ? student.siblingPhone
                  : null
              }
              onFilled={() => {
                const inputs = document.querySelectorAll<HTMLInputElement>(
                  `#student-${CSS.escape(student.studentId)} input`,
                );
                const next = inputs[index + 1];
                // Never jump onto a field she has already filled — she did not
                // ask to revisit it, and moving the caret there loses her place.
                if (next && next.value === "") {
                  next.focus();
                  return;
                }
                // Nothing left to fill in this row, so there is nothing to wait
                // for either. Commit it now rather than after the timer.
                onFilledLast();
              }}
            />
          ))}

          {/* A row that will not commit has to say so. Otherwise the only
              signal that a half-typed number was never counted is its absence
              from a total she has no reason to be adding up. */}
          {!ready && touched ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              अभी पूरा नहीं हुआ
            </p>
          ) : null}
        </div>
      ) : null}

      {/* -------------------------------------------------------- the actions */}
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {state.status === "todo" && !blank ? (
            <>
              <button
                type="button"
                onClick={answer(onConfirm)}
                className="min-h-12 flex-1 rounded-lg transition-transform active:scale-[0.98] border-2 border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 font-semibold text-[var(--color-confirm-fg)]"
              >
                सही है
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="min-h-12 flex-1 rounded-lg transition-transform active:scale-[0.98] border-2 border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 font-semibold text-[var(--color-correct-fg)]"
              >
                बदलें
              </button>
            </>
          ) : null}

          {answered ? (
            <button
              type="button"
              onClick={onReopen}
              className="min-h-12 rounded-lg border-2 border-[var(--color-border)] px-4 text-sm transition-transform active:scale-[0.98] font-medium text-[var(--color-ink-muted)]"
            >
              फिर से देखें
            </button>
          ) : null}
        </div>

        {/* नहीं है gets its own row, away from सही है. It used to be an
            underlined link sitting next to the confirm button — the easiest
            thing on the screen to hit by accident, and the most annoying to
            undo. Its own row, full height, low emphasis. */}
        {state.status !== "absent" ? (
          <button
            type="button"
            onClick={answer(onAbsent)}
            className="min-h-12 w-full rounded-lg border border-dashed transition-transform active:scale-[0.98] border-[var(--color-absent-border)] px-4 text-sm font-medium text-[var(--color-absent-fg)]"
          >
            यह बच्चा मेरी कक्षा में नहीं है
          </button>
        ) : null}
      </div>
    </li>
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
}: {
  student: TeacherRosterRow;
  fields: TeacherField[];
}) {
  const asked = new Set(fields.map((field) => field.key));
  const house = houseOf(student.house);

  const showRoute = student.route && !asked.has("bus_route");
  const showFather = student.fatherName && !asked.has("father_name");
  const showHouse = house && !asked.has("house");

  if (!student.srNo && !showRoute && !showFather && !showHouse) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-ink-muted)]">
      {student.srNo ? (
        <span className="font-mono text-xs">क्र. {student.srNo}</span>
      ) : null}

      {showHouse ? <HouseChip house={student.house} /> : null}

      {showFather ? <span>पिता: {titleCaseName(student.fatherName!)}</span> : null}
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
      className="mt-2 min-h-12 w-full rounded-lg border-2 border-dashed border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-3 text-sm font-medium text-[var(--color-correct-fg)] transition-transform active:scale-[0.98]"
    >
      {label} — लगाएँ
    </button>
  );
}

/**
 * One field's input.
 *
 * Three things matter here, all of them about not making her give up:
 *
 *   - The number pad is the only keyboard she should ever see for a phone
 *     number. inputMode="numeric" plus autoComplete="off".
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
  sibling,
}: {
  field: TeacherField;
  value: string;
  onChange: (value: string) => void;
  /** Last field in the row, so the keyboard offers Done rather than Next. */
  last: boolean;
  /** A fixed-length field just reached its length by growing. */
  onFilled: () => void;
  /** What the row above answered for this field, when carrying down is safe. */
  suggestion: string | null;
  /** A sibling's number, on a blank phone field only. */
  sibling: { name: string; phone: string } | null;
}) {
  const [touched, setTouched] = useState(false);
  const isNumeric = numeric(field);
  const check = validateField(field, value);
  const full = field.exactLen !== null && value.length >= field.exactLen;
  const bad = value !== "" && !check.ok && (touched || full);

  // Two buttons, not a checkbox. A checkbox has one visible state and its
  // unticked state is indistinguishable from "nobody has looked at this" — the
  // exact ambiguity the whole review path exists to avoid.
  if (field.inputType === "boolean") {
    return (
      <div>
        <span className="text-label text-[var(--color-ink-muted)]">
          {field.labelHi}
        </span>
        <div className="mt-1 flex gap-2">
          {[
            { value: "yes", label: "हाँ" },
            { value: "no", label: "नहीं" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                tick();
                onChange(option.value);
              }}
              className={`min-h-12 flex-1 rounded-lg border-2 px-4 font-semibold transition-transform active:scale-[0.98] ${
                value === option.value
                  ? "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
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
          <span className="text-label text-[var(--color-ink-muted)]">
            {field.labelHi}
          </span>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => setTouched(true)}
            list={`options-${field.key}`}
            enterKeyHint={last ? "done" : "next"}
            autoComplete="off"
            autoCapitalize="words"
            placeholder="टाइप करके ढूँढें"
            className={`mt-1 min-h-12 w-full rounded-lg border-2 px-3 text-base ${
              bad
                ? "border-[var(--color-danger)]"
                : "border-[var(--color-border)]"
            }`}
          />
          <datalist id={`options-${field.key}`}>
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {suggestion && !value ? (
            <SuggestChip label={`पिछले जैसा: ${suggestion}`} onUse={onChange} value={suggestion} />
          ) : null}
          {bad ? (
            <span role="alert" className="mt-1 block text-sm text-[var(--color-danger)]">
              सूची में से चुनें
            </span>
          ) : null}
        </label>
      );
    }

    return (
      <label className="block">
        <span className="text-label text-[var(--color-ink-muted)]">
          {field.labelHi}
        </span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 min-h-12 w-full rounded-lg border-2 border-[var(--color-border)] px-3 text-base"
        >
          <option value="">— चुनें —</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {suggestion && !value ? (
          <SuggestChip label={`पिछले जैसा: ${suggestion}`} onUse={onChange} value={suggestion} />
        ) : null}
      </label>
    );
  }

  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-label text-[var(--color-ink-muted)]">
        <span>{field.labelHi}</span>
        {isNumeric && field.exactLen && value.length > 0 ? (
          <span className="font-mono text-xs">
            {value.length} / {field.exactLen}
          </span>
        ) : null}
      </span>
      <input
        value={value}
        onChange={(event) => {
          const next = clean(field, event.target.value);
          onChange(next);
          // Move on only when the field GREW into a complete value. Doing it on
          // any change would yank the caret away the moment she backspaces to
          // correct the last digit, which is exactly when she needs to stay.
          if (
            field.exactLen !== null &&
            next.length === field.exactLen &&
            next.length > value.length
          ) {
            onFilled();
          }
        }}
        onBlur={() => setTouched(true)}
        type={field.inputType === "date" ? "date" : "text"}
        inputMode={isNumeric ? "numeric" : "text"}
        enterKeyHint={last ? "done" : "next"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize={isNumeric ? "off" : "words"}
        // No maxLength on a numeric field: it would truncate a pasted
        // "+91 98765 43210" to its first ten CHARACTERS before clean() ever saw
        // it, leaving a mangled number. clean() caps the digits instead.
        maxLength={isNumeric ? undefined : (field.exactLen ?? undefined)}
        className={`mt-1 min-h-12 w-full rounded-lg border-2 px-3 text-base ${
          bad ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
        } ${isNumeric ? "font-mono" : ""}`}
      />
      {/* Siblings share a parent's mobile — 134 numbers in this school already
          do. Offered as a tap on a blank field, never prefilled: she is the one
          who knows whether these two children really are brother and sister,
          and the answer still goes through the office review queue. */}
      {sibling && !value ? (
        <SuggestChip
          label={`${sibling.name} का नंबर: ${sibling.phone}`}
          value={sibling.phone}
          onUse={onChange}
        />
      ) : null}

      {bad ? (
        <span
          role="alert"
          className="mt-1 block text-sm font-medium text-[var(--color-danger)]"
        >
          {check.ok ? "" : check.errorHi}
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

function optionsOf(field: TeacherField): string[] {
  return Array.isArray(field.options) ? field.options.map(String) : [];
}
