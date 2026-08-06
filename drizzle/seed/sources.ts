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
 * The two standing rules this encodes:
 *   - the fee app is authoritative for CLASS ALLOCATION, every class, always.
 *     PSP disagrees about 17 students and PSP is simply wrong about where a
 *     child sits; its class names are still mapped, but only so a disagreement
 *     can be REPORTED, never so it can decide.
 *   - PSP is authoritative for WHO THE CHILD IS — name, parents, DOB, gender,
 *     category, and the mobile number the school actually rings.
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

  // PSP knows who they are
  { fieldKey: "name", sourceKey: "psp" },
  { fieldKey: "father_name", sourceKey: "psp" },
  { fieldKey: "mother_name", sourceKey: "psp" },
  { fieldKey: "dob", sourceKey: "psp" },
  { fieldKey: "gender", sourceKey: "psp" },
  { fieldKey: "category", sourceKey: "psp" },
  { fieldKey: "phone", sourceKey: "psp" },

  // the election list is the only thing that holds a house
  { fieldKey: "house", sourceKey: "election" },
];
