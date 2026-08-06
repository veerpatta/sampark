import "../drizzle/env";
import type { Student } from "../drizzle/schema";

/**
 * Fixtures.
 *
 * Every value here is invented. THE REPO IS PUBLIC — no real student name, SR
 * number, mobile number or Aadhaar number appears in the test suite any more
 * than it does in a seed file (standing rule 12).
 */
export function student(overrides: Partial<Student> & { id: string }): Student {
  return {
    srNo: null,
    admissionNo: null,
    classLabel: "Class 6",
    section: null,
    rollNo: null,
    name: "Test Student",
    fatherName: null,
    motherName: null,
    phone: null,
    altPhone: null,
    dob: null,
    gender: null,
    category: null,
    aadhaar: null,
    janAadhaar: null,
    village: null,
    address: null,
    busRoute: null,
    house: null,
    aadhaarLast4: null,
    status: "active",
    source: "psp",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Build the shape parseTabularFile returns, from an array of row objects. */
export function table(rows: Record<string, string>[]) {
  return { headers: Object.keys(rows[0] ?? {}), rows };
}
