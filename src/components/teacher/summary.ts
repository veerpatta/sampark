import {
  ANSWERED,
  type RowState,
  type TeacherField,
  type TeacherRosterRow,
} from "./types";

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
  labelHi: string;
  /** What the school held. Null when it held nothing. */
  from: string | null;
  to: string;
};

export type NamedStudent = { studentId: string; name: string };

export type Summary = {
  /** Every field she actually altered, one entry each, oldest field order. */
  changed: ChangedValue[];
  /** Rows she confirmed as already correct. A count is all she needs. */
  confirmed: NamedStudent[];
  /** Rows she marked as not in this class. */
  notPresent: NamedStudent[];
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
  const untouched: NamedStudent[] = [];

  for (const student of roster) {
    const row = rows[student.studentId];
    const named = { studentId: student.studentId, name: student.name };

    if (!row || !ANSWERED.includes(row.status)) {
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
        labelHi: field.labelHi,
        from: student.values[field.key] ?? null,
        to: row.values[field.key]!,
      }));

    if (edits.length > 0) changed.push(...edits);
    else confirmed.push(named);
  }

  return {
    changed,
    confirmed,
    notPresent,
    untouched,
    empty: changed.length === 0 && confirmed.length === 0 && notPresent.length === 0,
  };
}
