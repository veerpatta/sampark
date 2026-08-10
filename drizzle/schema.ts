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
    house: text("house"), // Rana Pratap | Rana Kumbha | Bappa Rawal | Rana Sanga
    /**
     * PSP masks Aadhaar: 328 of 504 rows carry the LAST FOUR DIGITS ONLY and
     * there is not one full number in the file. Writing that into `aadhaar`
     * would look like real data, fail its exactLen 12 validation forever, and
     * make the field permanently un-collectable. It lands here instead and can
     * never satisfy the aadhaar field. Collecting the real number stays a
     * teacher job.
     */
    aadhaarLast4: text("aadhaar_last4"),
    /**
     * The pathname of a private Vercel Blob, not a URL.
     *
     * A private blob has no durable public URL, and a public one would be a
     * live credential — this column and every `submissions.new_value` behind it
     * would hold a permanently readable link to a photograph of a child.
     * Resolving a pathname to bytes needs the store token, which lives on the
     * server, so both read proxies can re-check who is asking. See lib/photos.ts.
     */
    photoPath: text("photo_path"),
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

/* ============ SOURCES AND PRECEDENCE ============ */

/**
 * Every place a value can come from.
 *
 * More files keep arriving, each covering some students and some fields, each
 * better than the others at something. A one-off importer per file does not
 * survive that — the third file silently overwrites what the second one got
 * right. So a value carries where it came from, and precedence decides who wins.
 */
export const sources = pgTable("sources", {
  key: text("key").primaryKey(), // psp | fees | election | teacher | office
  label: text("label").notNull(),
  kind: text("kind").notNull(), // import | collected | manual
  /**
   * Higher wins when no field-specific rule applies. `teacher` sits above every
   * import on purpose — see fieldSources.
   */
  rank: integer("rank").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/**
 * Which source is authoritative for which field. DATA, not a switch statement,
 * because this will change: the fee app owns class allocation today and might
 * not in a year.
 *
 * THE RULE THAT IS NOT IN THIS TABLE: an APPROVED TEACHER SUBMISSION OUTRANKS
 * EVERY IMPORT, for every field, always. It is enforced in code
 * (lib/precedence.ts) rather than as a row here precisely so nobody can switch
 * it off by editing a table. A teacher who corrected a number, had it approved,
 * and then watched a re-imported PSP export undo her work would never use the
 * tool again — that is the difference between this being trusted and abandoned.
 */
export const fieldSources = pgTable("field_sources", {
  fieldKey: text("field_key").primaryKey(), // students column name, e.g. 'class_label'
  sourceKey: text("source_key")
    .notNull()
    .references(() => sources.key),
});

/**
 * Where each individual value came from, and when.
 *
 * A SIDE TABLE rather than two columns per field on `students`. The registry is
 * data, not code — adding a collectable field must stay a database row, not a
 * deployment (plan principle 8) — and `source_key`/`source_updated_at` columns
 * per field would make every new field a migration, which breaks exactly that
 * rule. It is also sparse: most (student, field) pairs have no provenance yet,
 * and `students` stays readable as the master record it is.
 *
 * The cost is a join on import. Imports are batch operations that already read
 * every candidate row, so it is one more query per run, not per value.
 */
export const valueSources = pgTable(
  "value_sources",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    /** The students column this describes, e.g. 'phone'. */
    fieldKey: text("field_key").notNull(),
    sourceKey: text("source_key")
      .notNull()
      .references(() => sources.key),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.fieldKey] }),
    index("value_sources_source_idx").on(t.sourceKey),
  ],
);

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

/**
 * Three kinds of ownership, all optional, all the same shape.
 *
 * `classes` is the original and still the common case: the class teacher is who
 * a request goes to. `houses` and `routes` exist because a request can be scoped
 * to a house or a bus route, and those cut across classes — a house-wise link
 * carries children from every class, so it goes to the house master, not to
 * nineteen class teachers.
 *
 * Arrays rather than a join table because ownership is a handful of strings per
 * teacher, read on every send and edited a few times a year. See lib/ownership.ts
 * for the rule that turns these into a recipient, which is deliberately allowed
 * to answer "more than one" and "nobody" rather than guess.
 */
export const teachers = pgTable(
  "teachers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    classes: text("classes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    houses: text("houses")
      .array()
      .notNull()
      .default(sql`'{}'`),
    routes: text("routes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    active: boolean("active").notNull().default(true),
    /**
     * Her durable link, or NULL for a teacher who has none.
     *
     * Same shape and entropy as requests.token — 16 base64url characters from
     * generateToken() — but a DIFFERENT NAMESPACE, resolved by a different
     * column and a different function. Called link_token rather than token so
     * no call site can read `teacher.token` and reach for resolveToken.
     *
     * THERE IS DELIBERATELY NO revoked_at. NULL is the revocation, and it is
     * the only representation that cannot be got wrong: a revoked_at sitting
     * beside a token that is still present means every future reader has to
     * remember to check a second column, and the one that forgets is a link
     * that outlived its own kill switch. Rotation overwrites this column in the
     * same UPDATE, so there is no instant where the old and new URLs both work.
     */
    linkToken: text("link_token"),
    /**
     * When it was issued. NEVER READ BY THE RESOLVER — this column has no say
     * in whether a link opens. It exists so the office screen can say "issued 3
     * Aug", which is how somebody tells whether the link in front of her
     * predates the last time everything was revoked.
     */
    linkIssuedAt: timestamp("link_issued_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("teachers_link_token_idx").on(t.linkToken)],
);

/**
 * Who teaches what, to which class.
 *
 * A TABLE, not a fourth text[] on `teachers`, and the difference is arity.
 * `classes`, `houses` and `routes` are lists of ONE string, which is exactly
 * why lib/ownership.ts gets to be an exact `.includes()`. An assignment is a
 * TRIPLE, and packing "maths|Class 8" into an array element would replace that
 * exactness with a delimiter parser — the same trade the route-matching comment
 * above already refuses. It is also the wrong shape for the question the
 * fan-out actually asks: (subject, class) -> teacher, which is a two-column
 * index rather than a scan of twenty arrays.
 *
 * THERE IS DELIBERATELY NO UNIQUE INDEX ON (subject_key, class_label). Two
 * teachers down for one subject in one class is a real thing — a handover
 * mid-year, a section split, or simply a timetable that has drifted — and it
 * has to be REPRESENTABLE so planSubjectFanOut can report it and refuse. A
 * constraint here would turn "the office chooses" into "the second import
 * throws", which is the same guess wearing a database error. Exactly the
 * reasoning that lets two teachers hold one house.
 *
 * `assigned_by` separates what the timetable importer put here from what the
 * office typed. Without it, a re-import after the timetable drifts silently
 * undoes every correction anyone made in Settings.
 */
export const teacherSubjects = pgTable(
  "teacher_subjects",
  {
    teacherId: text("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    /** A key from SUBJECTS in src/lib/subjects.ts, e.g. 'maths'. */
    subjectKey: text("subject_key").notNull(),
    /** One of CLASS_LABELS. Validated on write, never inferred. */
    classLabel: text("class_label").notNull(),
    /** timetable | office */
    assignedBy: text("assigned_by").notNull().default("office"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teacherId, t.subjectKey, t.classLabel] }),
    // The lookup planSubjectFanOut runs once per (subject, class) in scope.
    index("teacher_subjects_lookup_idx").on(t.subjectKey, t.classLabel),
  ],
);

export type TeacherSubject = typeof teacherSubjects.$inferSelect;

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

/**
 * One bulk send: the question the office asked, once, of many groups.
 *
 * A request is one token, one frozen roster, one recipient — that shape is load
 * bearing and is not being changed. "Ask every class for phone numbers" is
 * therefore nineteen requests, and this row is what makes them one thing
 * afterwards: a status board, a resumable send queue, and a record of what was
 * actually asked rather than nineteen rows that merely look alike.
 *
 * `audience` is the office's selection as given, not the resolved roster. The
 * roster is frozen per request in request_students and is the only truth about
 * who was asked; this column answers "what did she tick", which is what a resume
 * needs to finish the job.
 */
export const requestBatches = pgTable("request_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** { classes: [], houses: [], routes: [], allActive: bool } */
  audience: jsonb("audience").notNull(),
  fieldKeys: text("field_keys").array().notNull(),
  period: text("period"),
  dueDate: date("due_date").notNull(),
  recipientMode: text("recipient_mode").notNull(), // class_teacher | incharge
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(), // 16-char url-safe, crypto random
    title: text("title").notNull(),
    /**
     * NULL for a link scoped to a house or a bus route, whose roster spans
     * classes. Kept as a real class label rather than being made to hold "Rana
     * Pratap": the column joins against students.class_label and is validated by
     * isClassLabel, and a column whose name stops being true is a trap for every
     * later reader. `audienceKind` and `audienceLabel` carry the general case.
     */
    classLabel: text("class_label"),
    /** class | house | route */
    audienceKind: text("audience_kind").notNull().default("class"),
    /** How the group reads on screen and in the WhatsApp message. */
    audienceLabel: text("audience_label").notNull(),
    /** Set when this request was one of a bulk send. NULL for a one-off. */
    batchId: uuid("batch_id").references(() => requestBatches.id, {
      onDelete: "set null",
    }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => teachers.id),
    fieldKeys: text("field_keys").array().notNull(),
    period: text("period"), // required when collecting marks
    dueDate: date("due_date").notNull(),
    /**
     * The optional 4-digit PIN from plan section 5 was removed on request. A
     * link is now a pure bearer token: whoever holds it can open that one
     * class. The plan's threat model already accepted forwarding as
     * proportionate — the same teacher carries a paper register with the same
     * data — and the mitigations that remain are the short expiry, the 3-day
     * grace cut-off, close/reopen, and the fact that no link reaches more than
     * one class. Worth revisiting before an Aadhaar collection round.
     */
    status: text("status").notNull().default("open"), // open | submitted | closed | expired
    /**
     * The number this link was actually sent to, when it is not the teacher's
     * saved one. NULL means "use teachers.phone".
     *
     * The office often knows a better number for one round — she is on leave
     * and her sister is covering, the saved number is a landline, we never had
     * one at all. Typing it here sends the link and changes nothing else.
     * Changing a teacher's saved number stays a separate, deliberate act in
     * settings, because that one affects every future request.
     */
    contactPhone: text("contact_phone"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * When the office actually handed this link over on WhatsApp.
     *
     * Server state, not localStorage: a bulk send is worked through one
     * recipient at a time and she may well finish it on a different device, or
     * hand the phone to someone else. It is also a different fact from
     * `opened_at` — "we sent it" versus "she read it" — which is why it is a
     * separate column rather than a reuse of one that has never been written.
     */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: text("sent_by").references(() => users.id),
    /**
     * Hidden from the boards, kept in the database.
     *
     * The office asked to be able to delete a closed request. A request that
     * collected nothing really is deleted — there is no history to lose. One
     * that collected answers cannot be, and not merely as a policy: submissions
     * reference it with no cascade, and app_rw has DELETE revoked on that table
     * (Rule 4, drizzle/sql/grants.sql). The row would have to outlive the button
     * whatever this column said, so archiving is the honest version of the same
     * intent — the clutter goes, the evidence does not.
     *
     * Deliberately not a `status` value. Status says what the LINK is doing and
     * is read by resolveToken; whether the office wants to look at the row is a
     * different fact, and folding them together would mean un-archiving had to
     * guess whether to restore `open` or `closed`.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("requests_token_idx").on(t.token),
    index("requests_batch_idx").on(t.batchId),
    /**
     * One link per group per batch. This is what makes Resume safe: a fan-out
     * that failed halfway is finished by creating the scopes that are missing,
     * and a double-tapped Resume racing itself hits this index instead of
     * minting a second token for a group that already has one.
     */
    uniqueIndex("requests_batch_scope_idx")
      .on(t.batchId, t.audienceKind, t.audienceLabel)
      .where(sql`${t.batchId} is not null`),
  ],
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
    /**
     * One value per submit batch, generated on the phone. A dropped connection
     * on a bad signal means the teacher taps send again, and without this that
     * second attempt writes the whole batch twice. NULL for anything written
     * before Phase 5, which is why the unique index below tolerates it.
     */
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("submissions_request_review_idx").on(t.requestId, t.reviewStatus),
    index("submissions_student_field_idx").on(t.studentId, t.fieldKey),
    // Makes a replayed batch a no-op rather than a duplicate. NULLs are
    // distinct in a Postgres unique index, so pre-Phase-5 rows are unaffected.
    uniqueIndex("submissions_idempotency_idx").on(
      t.idempotencyKey,
      t.studentId,
      t.fieldKey,
    ),
  ],
);

/* ============ RATE LIMITING ============ */

/**
 * Counters for the teacher-facing surface, from plan section 5: 30 requests per
 * minute per token, 100 per hour per IP.
 *
 * In Postgres rather than in memory because Vercel runs many instances and each
 * one would otherwise keep its own private count — a limit of 30 across ten
 * instances is really a limit of 300. Upstash would also work; this avoids a
 * dependency the plan does not require and a second service to keep alive.
 *
 * One upsert per request, on a table with a handful of rows. Cheap.
 */
export const rateLimits = pgTable("rate_limits", {
  bucket: text("bucket").primaryKey(), // 'token:xyz' | 'ip:1.2.3.4'
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

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
export type RateLimit = typeof rateLimits.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type FieldSource = typeof fieldSources.$inferSelect;
export type ValueSource = typeof valueSources.$inferSelect;
