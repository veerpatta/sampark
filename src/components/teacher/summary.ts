import {
  COMPLETE,
  requiredKeys,
  type RowState,
  type TeacherField,
  type TeacherRosterRow,
} from "./types";
import { missingRequired } from "./autosave";

/**
 * What she is about to send, worked out before she sends it.
 *
 * She taps through forty-six rows and one fat-fingered digit goes to the
 * office. Nobody catches it until a fee reminder bounces off a wrong number
 * months later, by which time the number in master is wrong and nobody knows
 * it came from here. A summary screen costs one tap and catches it now.
 *
 * Pure — no React, no DOM, no database — so the review screen and a test can
 * both ask the same question and get the same answer.
 *
 * NOTE this decides nothing. The server still re-derives confirmed / changed /
 * not_present by comparing against the frozen snapshot, and still does not
 * trust a word the browser says about it. This is a reading aid for her, not a
 * claim to the office. See lib/submissions.ts.
 */

export type ChangedValue = {
  studentId: string;
  name: string;
  fieldKey: string;
  labelEn: string;
  labelHi: string;
  /** What the school held. Null when it held nothing. */
  from: string | null;
  to: string;
};

export type NamedStudent = { studentId: string; name: string };

/** A row that went to the school with a box still empty. */
export type PartialStudent = NamedStudent & {
  /**
   * The fields still waiting, as `{ en, hi }` pairs.
   *
   * A pair rather than one string because the receipt now shows both languages
   * and the screen must not be the place that decides which half exists — a
   * component that receives only Hindi cannot grow an English line later
   * without this type changing anyway.
   */
  missing: { en: string; hi: string }[];
};

export type Summary = {
  /** Every field she actually altered, one entry each, oldest field order. */
  changed: ChangedValue[];
  /** Rows she confirmed as already correct. A count is all she needs. */
  confirmed: NamedStudent[];
  /** Rows she marked as not in this class. */
  notPresent: NamedStudent[];
  /**
   * Rows that went to the school with a box the school holds nothing for still
   * empty.
   *
   * Its own bucket, and NOT folded into `untouched`. Saying "not answered yet"
   * about a number the office already has is the same lie in the other
   * direction, and she would go looking for a value she has already given.
   * Whatever she DID type still appears under `changed`.
   */
  partial: PartialStudent[];
  /**
   * Rows with no answer at all, INCLUDING ones left mid-edit.
   *
   * Half-typed is not answered. Counting it as done would be the same lie the
   * progress rail refuses to tell.
   */
  untouched: NamedStudent[];
  /** True when there is nothing at all to send. */
  empty: boolean;
};

export function summarise(
  roster: TeacherRosterRow[],
  fields: TeacherField[],
  rows: Record<string, RowState>,
): Summary {
  const changed: ChangedValue[] = [];
  const confirmed: NamedStudent[] = [];
  const notPresent: NamedStudent[] = [];
  const partial: PartialStudent[] = [];
  const untouched: NamedStudent[] = [];

  const labels = new Map(
    fields.map((field) => [
      field.key,
      { en: field.labelEn, hi: field.labelHi },
    ]),
  );

  for (const student of roster) {
    const row = rows[student.studentId];
    const named = { studentId: student.studentId, name: student.name };

    if (row?.status === "partial") {
      partial.push({
        ...named,
        missing: missingRequired(row, requiredKeys(student, fields)).map(
          (key) => labels.get(key) ?? { en: key, hi: key },
        ),
      });
      // Falls through to the edits below rather than continuing: what she DID
      // type has gone to the office and belongs on the receipt like any other
      // change.
    } else if (!row || !COMPLETE.includes(row.status)) {
      untouched.push(named);
      continue;
    }

    if (row.status === "absent") {
      notPresent.push(named);
      continue;
    }

    // Field order, not typing order, so the same student always reads the same
    // way down the screen.
    const edits = fields
      .filter((field) => {
        const typed = row.values[field.key];
        if (typed === undefined || typed === "") return false;
        // A value equal to what we already held is a confirmation she happened
        // to type out, not a change. Saying "9876543210 → 9876543210" would
        // make her check something that has not moved.
        return typed !== (student.values[field.key] ?? "");
      })
      .map((field) => ({
        studentId: student.studentId,
        name: student.name,
        fieldKey: field.key,
        labelEn: field.labelEn,
        labelHi: field.labelHi,
        from: student.values[field.key] ?? null,
        to: row.values[field.key]!,
      }));

    if (edits.length > 0) changed.push(...edits);
    // A partial row is never "confirmed". She can reach this line by retyping a
    // value we already held while another box stayed empty — one entered field,
    // no diff — and listing that under "you confirmed these" would tell her the
    // card was finished, which is the whole thing being fixed.
    else if (row.status !== "partial") confirmed.push(named);
  }

  return {
    changed,
    confirmed,
    notPresent,
    partial,
    untouched,
    empty:
      changed.length === 0 &&
      confirmed.length === 0 &&
      notPresent.length === 0 &&
      partial.length === 0,
  };
}
