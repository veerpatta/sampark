import type { NewFieldDef } from "../schema";
import { HOUSES } from "../../src/lib/houses";
import { BUS_ROUTES } from "../../src/lib/routes";

/**
 * The route list moved to src/lib/routes.ts once runtime UI needed it — a page
 * must not import from the seed. Re-exported here so existing importers of this
 * module keep working.
 */
export { BUS_ROUTES };

/**
 * Starting field registry — SAMPARK_BUILD_PLAN.md section 9.
 *
 * Adding a collectable field is a row here, not a deployment.
 *
 * `mode` is set from what the school ACTUALLY HOLDS, measured against the real
 * data. It moved once already and that is the point of measuring rather than
 * assuming: against the fee app alone, seven fields were empty for 100% of
 * students and became 'collect'. PSP then arrived and filled five of them.
 *
 *     phone            504/504  100%  verify   (PSP; fee app had 386)
 *     name/father/
 *       mother/dob/
 *       gender/category 504/504 100%  verify   (PSP)
 *     alt_phone        284/504   56%  verify   (fee app, mother's number)
 *     bus_route        257/504   51%  verify   (fee app)
 *     house            151/504   30%  verify   (election list)
 *     aadhaar            0/504    0%  collect  (PSP's is masked — see below)
 *     jan_aadhaar        0/504    0%  collect
 *     village            0/504    0%  collect  (PSP has an address, not a village)
 *
 * A 'verify' field with no stored value asks a teacher to confirm a blank: a tap
 * that achieves nothing and teaches her the screen is busywork. A 'collect'
 * field opens its input directly. Flip one back to 'verify' once an import has
 * actually filled it — measure first.
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
  {
    key: "father_name",
    labelEn: "Father's name",
    labelHi: "पिता का नाम",
    mode: "verify",
    inputType: "text",
    targetColumn: "father_name",
    sortOrder: 40,
  },
  {
    key: "mother_name",
    labelEn: "Mother's name",
    labelHi: "माता का नाम",
    mode: "verify",
    inputType: "text",
    targetColumn: "mother_name",
    sortOrder: 50,
  },
  {
    key: "dob",
    labelEn: "Date of birth",
    labelHi: "जन्म तिथि",
    mode: "verify",
    inputType: "date",
    targetColumn: "dob",
    sortOrder: 60,
  },
  {
    key: "gender",
    labelEn: "Gender",
    labelHi: "लिंग",
    mode: "verify",
    inputType: "select",
    targetColumn: "gender",
    // PSP's own values, 258 Male / 246 Female. Stored as PSP writes them so a
    // diff against PSP stays readable.
    options: ["Male", "Female"],
    sortOrder: 65,
  },
  {
    key: "category",
    labelEn: "Category",
    labelHi: "श्रेणी",
    mode: "verify",
    inputType: "select",
    targetColumn: "category",
    /**
     * The school's actual categories, not the plan's guess. The seed used to
     * say GEN/OBC/SC/ST/EWS: PSP writes GENERAL not GEN, has 45 students in
     * SBC which was not in the list at all, and zero in EWS. An import that
     * silently drops 45 SBC children is worse than one that fails.
     */
    options: ["GENERAL", "OBC", "SC", "SBC", "ST"],
    sortOrder: 70,
  },
  {
    /**
     * The one field a child answers instantly and a teacher verifies at a
     * glance — which makes it the best recognition aid on the roster. Rendered
     * as a coloured chip, never as text in a dropdown. Colours live in
     * tokens.css; HOUSES below carries the mapping.
     */
    key: "house",
    labelEn: "House",
    labelHi: "सदन",
    mode: "verify",
    inputType: "select",
    targetColumn: "house",
    options: HOUSES.map((house) => house.name),
    sortOrder: 75,
  },

  // --- collect: we hold nothing, so there is nothing to confirm ---
  {
    key: "aadhaar",
    labelEn: "Aadhaar number",
    labelHi: "आधार नंबर",
    mode: "collect",
    inputType: "tel",
    targetColumn: "aadhaar",
    exactLen: 12,
    sortOrder: 80,
  },
  {
    key: "jan_aadhaar",
    labelEn: "Jan Aadhaar",
    labelHi: "जन आधार",
    mode: "collect",
    inputType: "text",
    targetColumn: "jan_aadhaar",
    sortOrder: 90,
  },
  {
    key: "village",
    labelEn: "Village",
    labelHi: "गाँव",
    mode: "collect",
    inputType: "text",
    targetColumn: "village",
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
