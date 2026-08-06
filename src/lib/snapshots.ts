import { readStudentColumn } from "./student-columns";
import { isCompletePhone, normalisePhone } from "./phone";
import type { FieldDef, Student } from "../../drizzle/schema";

/**
 * The roster snapshot — what one student's row on the teacher's phone was
 * prefilled with.
 *
 * The snapshot is the whole point of this module. `request_students.snapshot`
 * freezes what the teacher was actually shown at the moment the link was sent,
 * and it is NEVER recomputed. If a phone number in master changes between
 * sending the link and reviewing the reply, the review screen must still say
 * "old value" = the number on the teacher's screen. Recomputing it would make
 * every review a guess. See plan section 4 and standing rule 6.
 *
 * RECOGNITION IS THE PRODUCT. When a request asks Class 8 for father's names,
 * the teacher gets 46 children she knows by face and by nickname and does not
 * know as a row in a spreadsheet. Every scrap of identifying data we hold makes
 * it faster for her to be SURE which child she is answering for, and being sure
 * is the whole thing. So the snapshot carries context beyond the fields being
 * asked about:
 *
 *   srNo    the one stable identifier, checkable against a paper register
 *   class   which class the child is in — a house or route roster spans several
 *   house   a coloured chip; the field a child answers instantly
 *   route   real context in a village school, present for about half
 *   father  known for all 504 since PSP landed
 *
 * Pure, and the prior-records read is the caller's job. A bulk send fans out to
 * nineteen classes off one audience; building snapshots per class would repeat
 * that query nineteen times for rows it already has.
 */
export type RosterSnapshot = {
  name: string;
  srNo: string | null;
  /** Frozen too: a house or route roster carries children from several classes. */
  classLabel: string | null;
  route: string | null;
  house: string | null;
  fatherName: string | null;
  /** Keyed by field_defs.key. null means "we hold nothing for this field". */
  values: Record<string, string | null>;
  /**
   * A number we already hold for a sibling of this child, when this child has
   * none. Offered on her screen as one tap rather than as a prefilled value.
   *
   * RULE 7 IS NOT BENT HERE. Name is never a MATCH key — it never decides which
   * record to overwrite. This proposes a value that a human then chooses to
   * apply, and the resulting submission goes through /review like any other.
   */
  siblingPhone: { name: string; phone: string } | null;
};

/** Key into the prior-records map: one period-scoped value per student+field. */
export const recordKey = (studentId: string, fieldKey: string) =>
  `${studentId}:${fieldKey}`;

export function buildSnapshots(
  roster: Student[],
  fields: FieldDef[],
  priorRecords: Map<string, string | null>,
): Map<string, RosterSnapshot> {
  const siblings = inferSiblingPhones(roster);
  const snapshots = new Map<string, RosterSnapshot>();

  for (const student of roster) {
    const values: Record<string, string | null> = {};

    for (const field of fields) {
      // readStudentColumn, not a raw lookup: target_column is a database name
      // and a Drizzle row is keyed by property name. See student-columns.ts.
      values[field.key] = field.targetColumn
        ? readStudentColumn(student, field.targetColumn)
        : (priorRecords.get(recordKey(student.id, field.key)) ?? null);
    }

    snapshots.set(student.id, {
      name: student.name,
      srNo: student.srNo,
      classLabel: student.classLabel,
      route: student.busRoute,
      house: student.house,
      fatherName: student.fatherName,
      values,
      siblingPhone: siblings.get(student.id) ?? null,
    });
  }

  return snapshots;
}

/**
 * For each child with no phone, a sibling's number if we hold one.
 *
 * Phone is the highest-value blank on any roster, and 134 numbers in this school
 * are already shared by more than one child because siblings share a parent's
 * mobile. When a teacher opens a blank row for a child whose brother we do have
 * a number for, retyping it from memory is work the app can save her.
 *
 * Matched on father's name, which is recorded for every student. Deliberately
 * conservative:
 *
 *   - a blank or unrecognisable father name groups nobody
 *   - a group where the known numbers disagree offers nothing, because picking
 *     one of two numbers is a guess and this is not allowed to guess
 *   - a child who already has a number is never given a suggestion
 *
 * Scoped to the roster being frozen, so it only ever proposes a number from a
 * child on the same teacher's screen.
 */
function inferSiblingPhones(
  roster: Student[],
): Map<string, { name: string; phone: string }> {
  const families = new Map<string, Student[]>();

  for (const student of roster) {
    const key = familyKey(student);
    if (!key) continue;
    const group = families.get(key) ?? [];
    group.push(student);
    families.set(key, group);
  }

  const found = new Map<string, { name: string; phone: string }>();

  for (const group of families.values()) {
    if (group.length < 2) continue;

    const withPhone = group.filter((student) => isCompletePhone(student.phone));
    if (withPhone.length === 0) continue;

    // One family, two different numbers on record. Which one belongs to the
    // child who has neither is exactly the question we cannot answer.
    const distinct = new Set(withPhone.map((s) => normalisePhone(s.phone)));
    if (distinct.size > 1) continue;

    const donor = withPhone[0]!;
    for (const student of group) {
      if (isCompletePhone(student.phone)) continue;
      found.set(student.id, {
        name: donor.name,
        phone: normalisePhone(donor.phone),
      });
    }
  }

  return found;
}

function familyKey(student: Student): string | null {
  const father = student.fatherName?.trim().replace(/\s+/g, " ").toLowerCase();
  return father ? father : null;
}
