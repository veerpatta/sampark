import type { NewSource } from "../schema";

/**
 * Where data can come from, and who outranks whom.
 *
 * `rank` only decides fields nobody owns in FIELD_SOURCES below. The named
 * ownership rules are the real mechanism; rank is the tie-breaker so a new file
 * can be slotted in without inventing a rule for every column it touches.
 *
 * teacher and office sit at the top and are also special-cased in
 * lib/precedence.ts — an approved teacher submission is never overwritten by an
 * import, and that must not be switchable by editing a row.
 */
export const SOURCES: NewSource[] = [
  { key: "election", label: "House / election list", kind: "import", rank: 10 },
  { key: "fees", label: "Fee Management App", kind: "import", rank: 20 },
  { key: "psp", label: "PSP Student Data Report", kind: "import", rank: 30 },
  { key: "office", label: "Office manual edit", kind: "manual", rank: 90 },
  { key: "teacher", label: "Teacher submission", kind: "collected", rank: 100 },
];

/**
 * Which source is authoritative for which column of `students`.
 *
 * Keys are DATABASE column names, because that is what the importer and the
 * field registry's `target_column` both speak.
 *
 * The standing rules this encodes:
 *   - the fee app is authoritative for CLASS ALLOCATION, every class, always.
 *     PSP disagrees about 17 students and PSP is simply wrong about where a
 *     child sits; its class names are still mapped, but only so a disagreement
 *     can be REPORTED, never so it can decide.
 *   - the fee app is also authoritative for THE NAME AND THE NUMBER — see the
 *     note on the block below, which is where that rule changed hands.
 *   - PSP still knows the things nobody rings or spells: gender and category.
 *
 * Anything absent from this map is first-writer-wins. That is deliberate: an
 * unowned field is one nobody has decided about yet, and guessing an owner is
 * worse than admitting there isn't one.
 */
export const FIELD_SOURCES: { fieldKey: string; sourceKey: string }[] = [
  // the fee app knows where a child sits and whether they are still enrolled
  { fieldKey: "class_label", sourceKey: "fees" },
  { fieldKey: "section", sourceKey: "fees" },
  { fieldKey: "status", sourceKey: "fees" },
  { fieldKey: "bus_route", sourceKey: "fees" },

  /*
   * THE NAME AND THE NUMBER MOVED TO THE FEE APP, AND HERE IS WHY.
   *
   * These five belonged to PSP on the reasoning that PSP is the identity
   * record. That was right about what PSP IS and wrong about what it DOES: PSP
   * is a snapshot, taken once, and it has not been re-exported since. The fee
   * app is open every working day, and when a receipt cannot be sent or a call
   * does not connect, it is the fee app the office corrects.
   *
   * So the September 2026 bundle disagreed with PSP about 212 mobile numbers
   * and 70 names, and it was right in the sample we checked both ways —
   * transposed digits fixed (8976105866 -> 8976015866) and surnames finally
   * filled in (RAJVEER -> RAJVEER SUTHAR). Under the old rule every one of
   * those 313 corrections was refused, which meant the office could fix a
   * number in the system it actually uses and Sampark would keep the wrong one
   * and keep ringing it.
   *
   * The ordering that matters is unchanged: an approved teacher correction
   * still beats both, permanently, and that is hardcoded in lib/precedence.ts
   * rather than left to this table.
   */
  { fieldKey: "name", sourceKey: "fees" },
  { fieldKey: "father_name", sourceKey: "fees" },
  { fieldKey: "mother_name", sourceKey: "fees" },
  { fieldKey: "dob", sourceKey: "fees" },
  { fieldKey: "phone", sourceKey: "fees" },

  /*
   * PSP keeps these two. The fee app carries them for only 51 of 535 children
   * and disagrees with PSP about none of them, so moving them would buy nothing
   * and lose the 480 rows PSP actually filled.
   */
  { fieldKey: "gender", sourceKey: "psp" },
  { fieldKey: "category", sourceKey: "psp" },

  // the election list is the only thing that holds a house
  { fieldKey: "house", sourceKey: "election" },
];
