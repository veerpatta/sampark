import type { NewFieldDef } from "../schema";

/**
 * Starting field registry — SAMPARK_BUILD_PLAN.md section 9.
 *
 * Adding a collectable field is a row here, not a deployment. Open decision #1
 * in the plan is the final list; these fourteen are the agreed starting point.
 */
export const FIELD_DEFS: NewFieldDef[] = [
  // --- verify: we hold a value and want it confirmed ---
  {
    key: "phone",
    labelEn: "Mobile number",
    labelHi: "मोबाइल नंबर",
    mode: "verify",
    inputType: "tel",
    targetColumn: "phone",
    exactLen: 10,
    sortOrder: 10,
  },
  {
    key: "alt_phone",
    labelEn: "Alternate mobile",
    labelHi: "दूसरा नंबर",
    mode: "verify",
    inputType: "tel",
    targetColumn: "alt_phone",
    exactLen: 10,
    sortOrder: 20,
  },
  {
    key: "father_name",
    labelEn: "Father's name",
    labelHi: "पिता का नाम",
    mode: "verify",
    inputType: "text",
    targetColumn: "father_name",
    sortOrder: 30,
  },
  {
    key: "mother_name",
    labelEn: "Mother's name",
    labelHi: "माता का नाम",
    mode: "verify",
    inputType: "text",
    targetColumn: "mother_name",
    sortOrder: 40,
  },
  {
    key: "dob",
    labelEn: "Date of birth",
    labelHi: "जन्म तिथि",
    mode: "verify",
    inputType: "date",
    targetColumn: "dob",
    sortOrder: 50,
  },
  {
    key: "aadhaar",
    labelEn: "Aadhaar number",
    labelHi: "आधार नंबर",
    mode: "verify",
    inputType: "tel",
    targetColumn: "aadhaar",
    exactLen: 12,
    sortOrder: 60,
  },
  {
    key: "jan_aadhaar",
    labelEn: "Jan Aadhaar",
    labelHi: "जन आधार",
    mode: "verify",
    inputType: "text",
    targetColumn: "jan_aadhaar",
    sortOrder: 70,
  },
  {
    key: "village",
    labelEn: "Village",
    labelHi: "गाँव",
    mode: "verify",
    inputType: "text",
    targetColumn: "village",
    sortOrder: 80,
  },
  {
    key: "bus_route",
    labelEn: "Bus route",
    labelHi: "बस रूट",
    mode: "verify",
    inputType: "select",
    targetColumn: "bus_route",
    // TODO: replace with the real VPPS route list before Phase 1 seed.
    options: [],
    sortOrder: 90,
  },
  {
    key: "category",
    labelEn: "Category",
    labelHi: "श्रेणी",
    mode: "verify",
    inputType: "select",
    targetColumn: "category",
    options: ["GEN", "OBC", "SC", "ST", "EWS"],
    sortOrder: 100,
  },

  // --- collect: we hold nothing and want new data ---
  // Open decision #7: max marks per FA subject. 25 assumed, confirm vs LEAD.
  {
    key: "fa_maths",
    labelEn: "FA Maths",
    labelHi: "गणित",
    mode: "collect",
    inputType: "number",
    targetColumn: null,
    recordKind: "fa_marks",
    maxValue: "25",
    sortOrder: 200,
  },
  {
    key: "fa_physics",
    labelEn: "FA Physics",
    labelHi: "भौतिक विज्ञान",
    mode: "collect",
    inputType: "number",
    targetColumn: null,
    recordKind: "fa_marks",
    maxValue: "25",
    sortOrder: 210,
  },
  {
    key: "fa_chemistry",
    labelEn: "FA Chemistry",
    labelHi: "रसायन विज्ञान",
    mode: "collect",
    inputType: "number",
    targetColumn: null,
    recordKind: "fa_marks",
    maxValue: "25",
    sortOrder: 220,
  },
  {
    key: "fa_biology",
    labelEn: "FA Biology",
    labelHi: "जीव विज्ञान",
    mode: "collect",
    inputType: "number",
    targetColumn: null,
    recordKind: "fa_marks",
    maxValue: "25",
    sortOrder: 230,
  },
];

/**
 * The saved field sets that used to live here now live in src/lib/templates.ts,
 * because the request builder needs them at runtime and a seed file is not a
 * runtime dependency.
 */
