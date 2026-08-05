/**
 * Sampark database schema.
 *
 * Transcribed from SAMPARK_BUILD_PLAN.md section 4. Read that section before
 * changing anything here — several of these tables carry rules that are not
 * obvious from the column list alone:
 *
 *   - `submissions` and `change_log` are APPEND-ONLY. The application role
 *     (`app_rw`) is granted INSERT and SELECT only, plus UPDATE on the single
 *     column `submissions.review_status`. Enforced in the database, not in
 *     code. See section 4.2.
 *   - `request_students.snapshot` freezes what the teacher actually saw at the
 *     moment the link was sent. Review is untrustworthy without it.
 *   - `field_defs` is a registry: adding a collectable field is a row, not a
 *     deployment.
 */
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============ MASTER RECORD ============ */

export const students = pgTable(
  "students",
  {
    id: text("id").primaryKey(), // VPPS student ID, e.g. 'S1001'
    srNo: text("sr_no"),
    admissionNo: text("admission_no"),
    classLabel: text("class_label").notNull(), // '6', '9', '12 Sci'
    section: text("section"),
    rollNo: integer("roll_no"),
    name: text("name").notNull(),
    fatherName: text("father_name"),
    motherName: text("mother_name"),
    phone: text("phone"),
    altPhone: text("alt_phone"),
    dob: date("dob"),
    gender: text("gender"),
    category: text("category"),
    aadhaar: text("aadhaar"),
    janAadhaar: text("jan_aadhaar"),
    village: text("village"),
    address: text("address"),
    busRoute: text("bus_route"),
    status: text("status").notNull().default("active"), // active | left | tc_issued
    source: text("source").default("psp"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("students_class_roll_idx").on(t.classLabel, t.rollNo),
    index("students_sr_no_idx").on(t.srNo),
    index("students_status_idx").on(t.status),
  ],
);

/* ============ FIELD REGISTRY ============ */

export const fieldDefs = pgTable("field_defs", {
  key: text("key").primaryKey(), // 'phone', 'fa_maths'
  labelEn: text("label_en").notNull(),
  labelHi: text("label_hi").notNull(),
  /**
   * 'verify' — we already hold a value and want it confirmed.
   * 'collect' — we hold nothing and want new data (marks, Aadhaar we never had).
   */
  mode: text("mode").notNull(),
  inputType: text("input_type").notNull(), // text | tel | date | number | select
  /**
   * Column on `students` this field writes to. NULL means the value is not
   * master data and lands in `student_records` under `recordKind` instead.
   */
  targetColumn: text("target_column"),
  recordKind: text("record_kind"), // e.g. 'fa_marks' when targetColumn IS NULL
  maxValue: numeric("max_value"),
  exactLen: integer("exact_len"), // 10 for phone, 12 for aadhaar
  pattern: text("pattern"),
  options: jsonb("options"), // for input_type = 'select'
  sortOrder: integer("sort_order").default(100),
  active: boolean("active").notNull().default(true),
});

/* ============ NON-MASTER DATA (marks, term-scoped values) ============ */

export const studentRecords = pgTable(
  "student_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    fieldKey: text("field_key")
      .notNull()
      .references(() => fieldDefs.key),
    period: text("period").notNull(), // '2026-27/FA1'
    value: text("value"),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("student_records_unique").on(t.studentId, t.fieldKey, t.period),
  ],
);

/* ============ PEOPLE ============ */

export const teachers = pgTable("teachers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  classes: text("classes")
    .array()
    .notNull()
    .default(sql`'{}'`),
  active: boolean("active").notNull().default(true),
});

/**
 * Admin console users only. Teachers never have an account — the token in the
 * URL is the entire onboarding.
 *
 * Roles:
 *   owner  — everything, including the field registry and user management
 *   admin  — create requests and approve changes into master
 *   office — create requests and view, but CANNOT approve into master
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("office"), // owner | admin | office
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ============ REQUESTS ============ */

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(), // 16-char url-safe, crypto random
    title: text("title").notNull(),
    classLabel: text("class_label").notNull(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => teachers.id),
    fieldKeys: text("field_keys").array().notNull(),
    period: text("period"), // required when collecting marks
    dueDate: date("due_date").notNull(),
    pin: text("pin"), // optional 4-digit gate
    status: text("status").notNull().default("open"), // open | submitted | closed | expired
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("requests_token_idx").on(t.token)],
);

/* ============ ROSTER SNAPSHOT ============ */

/**
 * Freezes who was in scope, and what we held, at the moment of sending.
 * If the master record changes between sending the link and reviewing the
 * reply, "old value -> new value" in the review screen must still refer to what
 * the teacher actually saw.
 */
export const requestStudents = pgTable(
  "request_students",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    rollNo: integer("roll_no"),
    snapshot: jsonb("snapshot").notNull(), // prefilled values exactly as sent
  },
  (t) => [primaryKey({ columns: [t.requestId, t.studentId] })],
);

/* ============ SUBMISSIONS (APPEND-ONLY) ============ */

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    fieldKey: text("field_key")
      .notNull()
      .references(() => fieldDefs.key),
    action: text("action").notNull(), // confirmed | changed | not_present | absent
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reviewStatus: text("review_status").notNull().default("pending"), // pending | approved | rejected | auto
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientHash: text("client_hash"), // coarse device fingerprint, anti-abuse only
  },
  (t) => [
    index("submissions_request_review_idx").on(t.requestId, t.reviewStatus),
    index("submissions_student_field_idx").on(t.studentId, t.fieldKey),
  ],
);

/* ============ CHANGE LOG (the audit trail) ============ */

export const changeLog = pgTable("change_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  studentId: text("student_id").notNull(),
  fieldKey: text("field_key").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  decision: text("decision").notNull(), // approved | rejected
  decidedBy: text("decided_by")
    .notNull()
    .references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  note: text("note"),
});

/* ============ INFERRED TYPES ============ */

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type FieldDef = typeof fieldDefs.$inferSelect;
export type NewFieldDef = typeof fieldDefs.$inferInsert;
export type StudentRecord = typeof studentRecords.$inferSelect;
export type Teacher = typeof teachers.$inferSelect;
export type NewTeacher = typeof teachers.$inferInsert;
export type User = typeof users.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestStudent = typeof requestStudents.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type ChangeLogEntry = typeof changeLog.$inferSelect;
