/**
 * Saved field sets — plan section 9.
 *
 * A template is a name plus a list of field keys, nothing more. The request
 * builder offers these before the custom picker because picking "Mobile number
 * update" is one tap and picking two fields out of fourteen is not.
 *
 * These are a constant rather than a table on purpose: the field REGISTRY has
 * to be data (rule 11 — adding a collectable field is a row, not a deploy), but
 * a template is only a shortcut over that registry. When the office starts
 * wanting their own, move it to a table then.
 */
export type Template = {
  name: string;
  nameHi: string;
  fieldKeys: string[];
};

export const TEMPLATES: Template[] = [
  {
    name: "Mobile number update",
    nameHi: "मोबाइल नंबर अपडेट",
    fieldKeys: ["phone", "alt_phone"],
  },
  {
    name: "Parent names",
    nameHi: "माता-पिता के नाम",
    fieldKeys: ["father_name", "mother_name"],
  },
  { name: "Aadhaar drive", nameHi: "आधार", fieldKeys: ["aadhaar", "dob"] },
  {
    name: "Jan Aadhaar / DBT",
    nameHi: "जन आधार / DBT",
    fieldKeys: ["jan_aadhaar", "category"],
  },
  { name: "Transport", nameHi: "परिवहन", fieldKeys: ["bus_route", "village"] },
  /**
   * Photos on their own, never bundled with anything else.
   *
   * A photo round is a different physical act: she walks along the row with a
   * camera rather than reading a register. Mixing it with phone numbers means
   * neither job gets finished in one pass.
   */
  { name: "Student photos", nameHi: "बच्चों की फ़ोटो", fieldKeys: ["photo"] },
  {
    name: "FA marks (Science)",
    nameHi: "FA अंक (विज्ञान)",
    fieldKeys: ["fa_maths", "fa_physics", "fa_chemistry", "fa_biology"],
  },
];
