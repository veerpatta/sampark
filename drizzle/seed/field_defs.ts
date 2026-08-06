import type { NewFieldDef } from "../schema";

/**
 * The 29 bus routes, from the fee app's Routes sheet.
 *
 * "No Transport" is one of them and is a real answer, not a blank — a child who
 * walks to school has been asked and answered, and that is different from a
 * child nobody has asked.
 *
 * These are place names from the route master, not student data.
 */
export const BUS_ROUTES = [
  "Aambaghati",
  "Agariya",
  "Agariya Kotari",
  "Aidana",
  "Amet Bus",
  "Amet City",
  "Amet College Road (Colony Inside)",
  "Amet College Side (On Road)",
  "Amet Railway Station (Inside)",
  "Amet Railway Station (On Road)",
  "Ballo Ka Khera",
  "Banda",
  "Bhakroda",
  "Bhopji Ka Kheda",
  "Dabla",
  "Dhelana",
  "Ghosundi",
  "Gugli",
  "Jilola",
  "Kanji Ka Kedha",
  "Karera",
  "Makarda",
  "Masingpura",
  "Mund Koshiya",
  "No Transport",
  "Saprav",
  "Sardargarh",
  "Selaguda",
  "Tanvan",
];

/**
 * Starting field registry — SAMPARK_BUILD_PLAN.md section 9.
 *
 * Adding a collectable field is a row here, not a deployment.
 *
 * `mode` is set from what the school ACTUALLY HOLDS, measured against the real
 * 504-student export:
 *
 *     phone (Father phone)   386/504   77%   verify
 *     alt_phone (Mother)     284/504   56%   verify
 *     bus_route (Route)      257/504   51%   verify
 *     everything else          0/504    0%   collect
 *
 * A 'verify' field with no stored value asks a teacher to confirm a blank, which
 * is a tap that achieves nothing and teaches her the screen is busywork. The
 * seven zero-coverage fields open their inputs directly instead. Flip one back
 * to 'verify' once a real import has actually filled it.
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
    // Mother phone in the export. Named for whose number it is, because
    // "दूसरा नंबर" tells a teacher nothing about which parent to ask.
    key: "alt_phone",
    labelEn: "Mother's mobile",
    labelHi: "माता का नंबर",
    mode: "verify",
    inputType: "tel",
    targetColumn: "alt_phone",
    exactLen: 10,
    sortOrder: 20,
  },
  {
    key: "bus_route",
    labelEn: "Bus route",
    labelHi: "बस रूट",
    mode: "verify",
    inputType: "select",
    targetColumn: "bus_route",
    options: BUS_ROUTES,
    sortOrder: 30,
  },

  // --- collect: we hold nothing, so there is nothing to confirm ---
  {
    key: "father_name",
    labelEn: "Father's name",
    labelHi: "पिता का नाम",
    mode: "collect",
    inputType: "text",
    targetColumn: "father_name",
    sortOrder: 40,
  },
  {
    key: "mother_name",
    labelEn: "Mother's name",
    labelHi: "माता का नाम",
    mode: "collect",
    inputType: "text",
    targetColumn: "mother_name",
    sortOrder: 50,
  },
  {
    key: "dob",
    labelEn: "Date of birth",
    labelHi: "जन्म तिथि",
    mode: "collect",
    inputType: "date",
    targetColumn: "dob",
    sortOrder: 60,
  },
  {
    key: "aadhaar",
    labelEn: "Aadhaar number",
    labelHi: "आधार नंबर",
    mode: "collect",
    inputType: "tel",
    targetColumn: "aadhaar",
    exactLen: 12,
    sortOrder: 70,
  },
  {
    key: "jan_aadhaar",
    labelEn: "Jan Aadhaar",
    labelHi: "जन आधार",
    mode: "collect",
    inputType: "text",
    targetColumn: "jan_aadhaar",
    sortOrder: 80,
  },
  {
    key: "village",
    labelEn: "Village",
    labelHi: "गाँव",
    mode: "collect",
    inputType: "text",
    targetColumn: "village",
    sortOrder: 90,
  },
  {
    key: "category",
    labelEn: "Category",
    labelHi: "श्रेणी",
    mode: "collect",
    inputType: "select",
    targetColumn: "category",
    options: ["GEN", "OBC", "SC", "ST", "EWS"],
    sortOrder: 100,
  },

  // --- collect: marks, which never existed here in the first place ---
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
