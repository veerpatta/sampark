import type { NewStudent, NewTeacher } from "../schema";

/**
 * A small, fake school — permanent fixtures for exercising the console.
 *
 * WHY THIS EXISTS AND WHY IT IS SAFE. The rule in scripts/create-user.ts still
 * stands: real names, real numbers and real passwords never enter this repo,
 * because the repo is public. Nothing here is real. Every child, teacher and
 * phone number below is invented, every id carries the TEST- prefix, and the
 * seeder refuses to run against a database holding anyone who is not one of
 * them (see scripts/seed-test-school.ts). Students still come from a real PSP
 * export through /students/import — this is not that, and must never become it.
 *
 * WHY A FILE RATHER THAN THE TEST FIXTURES. tests/fixtures.ts builds two
 * children and tears them down again, which is right for asserting one rule and
 * useless for looking at a screen. Half the console's bugs are only visible with
 * enough rows to sort, group and paginate — a class list that spans registers, a
 * marks round with one teacher finished and one not started, a phone shared by
 * siblings. Those need a school that stays put.
 *
 * PHONE NUMBERS are in the 99900xxxxx block and are deliberately shaped like
 * real ones: siblings share a parent's number, because 134 numbers in the real
 * school do and every screen that touches a phone has to survive it.
 */

export const TEST_PREFIX = "TEST-";

/** The one account the console is driven with. Password is never stored here. */
export const TEST_USER = {
  id: `${TEST_PREFIX}U-owner`,
  email: "test.owner@sampark.invalid",
  name: "Test Owner",
  role: "owner" as const,
};

export const TEST_TEACHERS: NewTeacher[] = [
  {
    id: `${TEST_PREFIX}T-sunita`,
    name: "Sunita Sharma",
    phone: "9990000001",
    classes: ["Class 8"],
    houses: ["Rana Pratap"],
    routes: [],
  },
  {
    id: `${TEST_PREFIX}T-hemlata`,
    name: "Hemlata Meena",
    phone: "9990000002",
    classes: ["Class 9"],
    houses: [],
    routes: ["Amet City"],
  },
  {
    id: `${TEST_PREFIX}T-ramesh`,
    name: "Ramesh Gurjar",
    phone: "9990000003",
    classes: ["Class 10"],
    houses: [],
    routes: [],
  },
  /*
   * TWO TEACHERS, ONE NAME, ON PURPOSE.
   *
   * teachers.id is the key; the name never was unique and two Sunita Sharmas in
   * one school is ordinary. This pair is what proves the marks export tells them
   * apart instead of collapsing both onto one sheet — see sheetLabels in
   * api/export/marks.xlsx. Nothing else in the fixtures would catch that.
   */
  {
    id: `${TEST_PREFIX}T-sunita2`,
    name: "Sunita Sharma",
    phone: "9990000004",
    classes: ["Class 7"],
    houses: [],
    routes: [],
  },
];

/** Who teaches what. Sunita takes maths for two classes, so she spans them. */
export const TEST_SUBJECTS = [
  { teacherId: `${TEST_PREFIX}T-sunita`, subjectKey: "maths", classLabel: "Class 8" },
  { teacherId: `${TEST_PREFIX}T-sunita`, subjectKey: "maths", classLabel: "Class 9" },
  { teacherId: `${TEST_PREFIX}T-hemlata`, subjectKey: "science", classLabel: "Class 8" },
  { teacherId: `${TEST_PREFIX}T-hemlata`, subjectKey: "science", classLabel: "Class 9" },
  { teacherId: `${TEST_PREFIX}T-ramesh`, subjectKey: "sst", classLabel: "Class 10" },
  { teacherId: `${TEST_PREFIX}T-sunita2`, subjectKey: "maths", classLabel: "Class 7" },
];

const HOUSES = ["Rana Pratap", "Rana Kumbha", "Bappa Rawal", "Rana Sanga"];
const ROUTES = ["Amet City", "Kelwa", "Deogarh", null];
const VILLAGES = ["Amet", "Kelwa", "Deogarh", "Bhim", "Rajsamand"];

/**
 * Invented names, combined mechanically so the list is long enough to sort and
 * page through without anyone having to write ninety of them by hand.
 */
const GIVEN = [
  "Aarti", "Bhavna", "Chetan", "Deepak", "Ekta", "Farhan", "Gita", "Hemant",
  "Isha", "Jitendra", "Kavita", "Lokesh", "Manisha", "Naveen", "Omprakash",
  "Pooja", "Rahul", "Seema", "Tarun", "Usha", "Vikram", "Yashoda",
];
const FAMILY = ["Sharma", "Meena", "Gurjar", "Jain", "Paliwal", "Regar"];

const CLASSES = ["Class 7", "Class 8", "Class 9", "Class 10"] as const;

/**
 * The roster. Deterministic — the same call always produces the same school, so
 * a re-seed updates rows rather than inventing a second set of children.
 *
 * Some fields are LEFT EMPTY on purpose, in roughly the proportions the real
 * data has them: about a third have no phone at all, two thirds have no
 * photograph, and none have a roll number. A fixture where every column is
 * filled is a fixture that never shows you the screen the office actually sees.
 */
export function testStudents(): NewStudent[] {
  const students: NewStudent[] = [];
  let n = 0;

  for (const [classIndex, classLabel] of CLASSES.entries()) {
    // Uneven sizes: a real school has no two classes the same.
    const size = [18, 24, 21, 15][classIndex]!;

    for (let i = 0; i < size; i += 1) {
      n += 1;
      const given = GIVEN[(classIndex * 7 + i) % GIVEN.length]!;
      const family = FAMILY[(classIndex * 3 + i) % FAMILY.length]!;
      const id = `${TEST_PREFIX}S${String(n).padStart(4, "0")}`;

      // Every fourth child has no number, and every seventh shares the previous
      // child's — siblings, which is the case that breaks naive de-duplication.
      const phone =
        i % 4 === 3
          ? null
          : i % 7 === 6
            ? `99900${String(10000 + n - 1).slice(-5)}`
            : `99900${String(10000 + n).slice(-5)}`;

      students.push({
        id,
        srNo: String(1000 + n),
        admissionNo: `A${String(1000 + n)}`,
        classLabel,
        rollNo: null,
        name: `${given} ${family}`,
        fatherName: `${FAMILY[(i + 1) % FAMILY.length]!} Lal ${family}`,
        motherName: i % 3 === 0 ? null : `${GIVEN[(i + 4) % GIVEN.length]!} Devi`,
        phone,
        altPhone: null,
        dob: `${2008 + classIndex}-0${(i % 9) + 1}-1${i % 9}`,
        gender: i % 2 === 0 ? "F" : "M",
        category: ["General", "OBC", "SC", "ST"][i % 4]!,
        aadhaar: null,
        janAadhaar: null,
        aadhaarLast4: String(1000 + (n * 7) % 9000),
        village: VILLAGES[i % VILLAGES.length]!,
        address: null,
        busRoute: ROUTES[i % ROUTES.length] ?? null,
        house: HOUSES[i % HOUSES.length]!,
        photoPath: null,
        status: "active",
        source: "psp",
      });
    }
  }

  // One child who has left, so the status filter has something to hide.
  students.push({
    ...students[0]!,
    id: `${TEST_PREFIX}S9999`,
    srNo: "1999",
    admissionNo: "A1999",
    name: "Zoya Khan",
    status: "left",
  });

  return students;
}
