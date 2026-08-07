import type { TeacherChoice, TeacherLike } from "./ownership";

/**
 * The sixteen subjects a Formative Assessment mark exists for.
 *
 * ONE ROW IS THE WHOLE MAPPING: the key stored in teacher_subjects, the label
 * on the office's screens, the Hindi name that reaches the teacher, the
 * field_defs key the marks land in, and the exact strings the timetable file
 * writes. The alternatives all lose:
 *
 *   - a convention (`fa_${key}`) does not survive "English compulsory";
 *   - a separate mapping table is a third thing to keep in step with two others;
 *   - a column on field_defs would make the collectable-data registry know
 *     about a timetable, and be null for fifteen of its rows.
 *
 * `timetable` is a LIST because that repo is maintained by another hand. When a
 * subject is renamed there this is the one edit, and the old spelling stays so
 * an older export still imports.
 *
 * ORDER IS DISPLAY ORDER, and field_defs.sortOrder is generated from it, so a
 * report card and the request builder cannot disagree about what comes first.
 */
export const SUBJECTS = [
  { key: "hindi", en: "Hindi", hi: "हिन्दी", fieldKey: "fa_hindi", timetable: ["Hindi"] },
  { key: "english", en: "English", hi: "अंग्रेज़ी", fieldKey: "fa_english", timetable: ["English compulsory"] },
  { key: "english_lit", en: "English Literature", hi: "अंग्रेज़ी साहित्य", fieldKey: "fa_english_lit", timetable: ["English Literature"] },
  { key: "sanskrit", en: "Sanskrit", hi: "संस्कृत", fieldKey: "fa_sanskrit", timetable: ["Sanskrit"] },
  { key: "maths", en: "Maths", hi: "गणित", fieldKey: "fa_maths", timetable: ["Maths"] },
  { key: "evs", en: "EVS", hi: "पर्यावरण अध्ययन", fieldKey: "fa_evs", timetable: ["EVS"] },
  { key: "science", en: "Science", hi: "विज्ञान", fieldKey: "fa_science", timetable: ["Science"] },
  { key: "physics", en: "Physics", hi: "भौतिक विज्ञान", fieldKey: "fa_physics", timetable: ["Physics"] },
  { key: "chemistry", en: "Chemistry", hi: "रसायन विज्ञान", fieldKey: "fa_chemistry", timetable: ["Chemistry"] },
  { key: "biology", en: "Biology", hi: "जीव विज्ञान", fieldKey: "fa_biology", timetable: ["Biology"] },
  { key: "sst", en: "Social Science", hi: "सामाजिक विज्ञान", fieldKey: "fa_sst", timetable: ["SST"] },
  { key: "geography", en: "Geography", hi: "भूगोल", fieldKey: "fa_geography", timetable: ["Geography"] },
  { key: "political_science", en: "Political Science", hi: "राजनीति विज्ञान", fieldKey: "fa_political_science", timetable: ["Political Science"] },
  { key: "economics", en: "Economics", hi: "अर्थशास्त्र", fieldKey: "fa_economics", timetable: ["Economics"] },
  { key: "accountancy", en: "Accountancy", hi: "लेखाशास्त्र", fieldKey: "fa_accountancy", timetable: ["Accountancy"] },
  { key: "business_studies", en: "Business Studies", hi: "व्यवसाय अध्ययन", fieldKey: "fa_business_studies", timetable: ["Business Studies"] },
] as const;

export type Subject = (typeof SUBJECTS)[number];
export type SubjectKey = Subject["key"];

/**
 * Timetable entries that carry no mark.
 *
 * LISTED, NOT INFERRED. A subject that quietly stops counting as academic
 * because nobody added it here is a marks round that silently skips a teacher,
 * and nothing on any screen would say so. ELGA is a five-teacher primary
 * activity block; the rest are periods, not subjects.
 */
export const NON_ACADEMIC = [
  "ELGA",
  "CCS",
  "Sports",
  "Robotics",
  "NoteBook Checking",
  "Self Study",
  "Free",
] as const;

/** What a teacher is down to teach, to one class. */
export type SubjectAssignment = {
  teacherId: string;
  subjectKey: string;
  classLabel: string;
};

const BY_KEY = new Map<string, Subject>(SUBJECTS.map((s) => [s.key, s]));
const BY_FIELD = new Map<string, Subject>(SUBJECTS.map((s) => [s.fieldKey, s]));
const BY_TIMETABLE = new Map<string, Subject>(
  SUBJECTS.flatMap((s) => s.timetable.map((name) => [normalise(name), s] as const)),
);
const NON_ACADEMIC_SET = new Set<string>(NON_ACADEMIC.map(normalise));

function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export const subjectByKey = (key: string): Subject | null => BY_KEY.get(key) ?? null;

export const subjectByFieldKey = (fieldKey: string): Subject | null =>
  BY_FIELD.get(fieldKey) ?? null;

/** The timetable's spelling → our subject, or null if we do not collect it. */
export const subjectFromTimetable = (name: string): Subject | null =>
  BY_TIMETABLE.get(normalise(name)) ?? null;

export const isNonAcademic = (name: string): boolean =>
  NON_ACADEMIC_SET.has(normalise(name));

/** Every field key a marks round could ask for. */
export const SUBJECT_FIELD_KEYS: string[] = SUBJECTS.map((s) => s.fieldKey);

/**
 * Who teaches this subject to this class?
 *
 * The same contract as chooseTeacherForScope in lib/ownership.ts — one, many,
 * or nobody, and never a guess — deliberately reusing that union rather than
 * inventing a second vocabulary for the same three outcomes. The lookup differs
 * (a table, not an array on the teacher row); the discipline does not.
 *
 * "Many" is a real state, not a data error: a subject handed over mid-year, or
 * a timetable that has drifted, genuinely has two names against it. The office
 * chooses. Nothing here picks the first one.
 */
export function chooseTeacherForSubject(
  assignments: SubjectAssignment[],
  teachers: TeacherLike[],
  subjectKey: string,
  classLabel: string,
): TeacherChoice {
  if (!subjectKey || !classLabel) {
    return { kind: "none", owners: [], message: "Pick a subject and a class first." };
  }

  const ids = new Set(
    assignments
      .filter((a) => a.subjectKey === subjectKey && a.classLabel === classLabel)
      .map((a) => a.teacherId),
  );
  const owners = teachers.filter((teacher) => ids.has(teacher.id));
  const where = `${subjectByKey(subjectKey)?.en ?? subjectKey} in ${classLabel}`;

  if (owners.length === 1) {
    return { kind: "one", teacherId: owners[0]!.id, owners };
  }
  if (owners.length > 1) {
    return {
      kind: "many",
      owners,
      message: `${owners.length} teachers are down for ${where} — choose one.`,
    };
  }
  return {
    kind: "none",
    owners: [],
    message: `Nobody is down for ${where}. Pick anyone, or fix it in Settings → Subjects.`,
  };
}
