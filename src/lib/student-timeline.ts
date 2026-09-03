import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { listDocuments, type DocumentRow } from "./document-store";
import { documentKindLabel } from "./documents";
import { FA_MARKS_KIND } from "./subjects";

/**
 * Everything that has ever happened to one child, in one list.
 *
 * The student page used to show two of these — the change log, and the marks
 * and answers — and nothing else. What it could not answer was the question a
 * parent's phone call actually raises: "you asked her teacher for this in
 * July; what did the teacher say, and did anyone act on it?" That lives in
 * `submissions`, which no console screen showed per child, and in
 * `request_students`, which none showed at all.
 *
 * Five reads, one merge. THE MERGE IS PURE and lives at the bottom, because the
 * grouping rules are where the mistakes would be: a review batch of nine rows
 * is one event, not nine; a teacher's forty answers in one flush are one event;
 * a document attached and later removed is two.
 */

export type LogRow = {
  id: number;
  fieldKey: string;
  fieldLabel: string | null;
  fromValue: string | null;
  toValue: string | null;
  decision: string;
  decidedBy: string;
  decidedByName: string;
  decidedAt: Date;
  note: string | null;
  submissionId: string | null;
};

export type SubmissionRow = {
  id: string;
  requestId: string;
  requestTitle: string | null;
  audienceLabel: string | null;
  teacherName: string | null;
  fieldKey: string;
  fieldLabel: string | null;
  inputType: string | null;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  reviewStatus: string;
  submittedAt: Date;
  idempotencyKey: string | null;
};

export type RecordRow = {
  id: number;
  fieldKey: string;
  fieldLabel: string;
  recordKind: string | null;
  maxValue: string | null;
  sortOrder: number | null;
  period: string;
  value: string | null;
  requestId: string | null;
  requestTitle: string | null;
  teacherName: string | null;
  createdAt: Date;
};

export type MembershipRow = {
  requestId: string;
  title: string;
  audienceLabel: string;
  teacherName: string | null;
  createdAt: Date;
  sentAt: Date | null;
  status: string;
};

export type TimelineParts = {
  log: LogRow[];
  submissions: SubmissionRow[];
  records: RecordRow[];
  memberships: MembershipRow[];
  documents: DocumentRow[];
};

export type TimelineKind =
  | "created"
  | "edited"
  | "approved"
  | "rejected"
  | "submitted"
  | "recorded"
  | "included"
  | "document_added"
  | "document_removed";

export type TimelineLine = {
  label: string;
  from?: string | null;
  to?: string | null;
  meta?: string;
  /** The values are blob pathnames, and want a picture rather than a string. */
  photo?: boolean;
};

export type TimelineEvent = {
  key: string;
  at: Date;
  kind: TimelineKind;
  /** The person or teacher responsible, when there is one to name. */
  who: string | null;
  title: string;
  lines: TimelineLine[];
  href?: string;
  note?: string | null;
};

/* ------------------------------------------------------------------ reads */

export async function loadTimelineParts(studentId: string): Promise<TimelineParts> {
  const [log, submissions, records, memberships, documents] = await Promise.all([
    db
      .select({
        id: schema.changeLog.id,
        fieldKey: schema.changeLog.fieldKey,
        fieldLabel: schema.fieldDefs.labelEn,
        fromValue: schema.changeLog.fromValue,
        toValue: schema.changeLog.toValue,
        decision: schema.changeLog.decision,
        decidedBy: schema.changeLog.decidedBy,
        decidedByName: schema.users.name,
        decidedAt: schema.changeLog.decidedAt,
        note: schema.changeLog.note,
        submissionId: schema.changeLog.submissionId,
      })
      .from(schema.changeLog)
      .innerJoin(schema.users, eq(schema.users.id, schema.changeLog.decidedBy))
      .leftJoin(schema.fieldDefs, eq(schema.fieldDefs.key, schema.changeLog.fieldKey))
      .where(eq(schema.changeLog.studentId, studentId))
      .orderBy(desc(schema.changeLog.decidedAt)),
    db
      .select({
        id: schema.submissions.id,
        requestId: schema.submissions.requestId,
        requestTitle: schema.requests.title,
        audienceLabel: schema.requests.audienceLabel,
        teacherName: schema.teachers.name,
        fieldKey: schema.submissions.fieldKey,
        fieldLabel: schema.fieldDefs.labelEn,
        inputType: schema.fieldDefs.inputType,
        action: schema.submissions.action,
        oldValue: schema.submissions.oldValue,
        newValue: schema.submissions.newValue,
        reviewStatus: schema.submissions.reviewStatus,
        submittedAt: schema.submissions.submittedAt,
        idempotencyKey: schema.submissions.idempotencyKey,
      })
      .from(schema.submissions)
      .leftJoin(schema.requests, eq(schema.requests.id, schema.submissions.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .leftJoin(schema.fieldDefs, eq(schema.fieldDefs.key, schema.submissions.fieldKey))
      .where(eq(schema.submissions.studentId, studentId))
      .orderBy(desc(schema.submissions.submittedAt)),
    db
      .select({
        id: schema.studentRecords.id,
        fieldKey: schema.studentRecords.fieldKey,
        fieldLabel: schema.fieldDefs.labelEn,
        recordKind: schema.fieldDefs.recordKind,
        maxValue: schema.fieldDefs.maxValue,
        sortOrder: schema.fieldDefs.sortOrder,
        period: schema.studentRecords.period,
        value: schema.studentRecords.value,
        requestId: schema.studentRecords.requestId,
        requestTitle: schema.requests.title,
        teacherName: schema.teachers.name,
        createdAt: schema.studentRecords.createdAt,
      })
      .from(schema.studentRecords)
      .innerJoin(schema.fieldDefs, eq(schema.fieldDefs.key, schema.studentRecords.fieldKey))
      .leftJoin(schema.requests, eq(schema.requests.id, schema.studentRecords.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(eq(schema.studentRecords.studentId, studentId))
      .orderBy(desc(schema.studentRecords.period), schema.studentRecords.fieldKey),
    db
      .select({
        requestId: schema.requests.id,
        title: schema.requests.title,
        audienceLabel: schema.requests.audienceLabel,
        teacherName: schema.teachers.name,
        createdAt: schema.requests.createdAt,
        sentAt: schema.requests.sentAt,
        status: schema.requests.status,
      })
      .from(schema.requestStudents)
      .innerJoin(schema.requests, eq(schema.requests.id, schema.requestStudents.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(eq(schema.requestStudents.studentId, studentId))
      .orderBy(desc(schema.requests.createdAt)),
    listDocuments(studentId, { includeRemoved: true }),
  ]);

  return {
    log,
    submissions,
    records: records.map((row) => ({ ...row, maxValue: row.maxValue === null ? null : String(row.maxValue) })),
    memberships,
    documents,
  };
}

/* ------------------------------------------------------------------ merge */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ties on the same instant read in this order, so a created record precedes its own edits. */
const KIND_ORDER: TimelineKind[] = [
  "document_removed",
  "document_added",
  "rejected",
  "approved",
  "edited",
  "recorded",
  "submitted",
  "included",
  "created",
];

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = out.get(key) ?? [];
    group.push(row);
    out.set(key, group);
  }
  return out;
}

function logEvents(log: LogRow[]): TimelineEvent[] {
  const groups = groupBy(log, (row) => `${row.decidedBy}|${row.decision}|${row.decidedAt.getTime()}`);
  return [...groups.entries()].map(([key, rows]) => {
    const first = rows[0]!;
    const n = rows.length;
    const kind: TimelineKind =
      first.decision === "approved"
        ? "approved"
        : first.decision === "rejected"
          ? "rejected"
          : first.decision === "created"
            ? "created"
            : "edited";
    const title =
      kind === "approved"
        ? `${plural(n, "change")} approved into the record`
        : kind === "rejected"
          ? `${plural(n, "proposed change")} rejected`
          : kind === "created"
            ? `Record created with ${plural(n, "field")}`
            : `${plural(n, "field")} edited by hand`;
    return {
      key: `log:${key}`,
      at: first.decidedAt,
      kind,
      who: first.decidedByName,
      title,
      lines: rows.map((row) => ({
        label: row.fieldLabel ?? row.fieldKey,
        from: row.fromValue,
        to: row.toValue,
        photo: row.fieldKey === "photo",
      })),
      note: rows.find((row) => row.note)?.note ?? null,
    };
  });
}

function submissionEvents(submissions: SubmissionRow[]): TimelineEvent[] {
  const groups = groupBy(
    submissions,
    (row) => `${row.requestId}|${row.idempotencyKey ?? row.submittedAt.getTime()}`,
  );
  return [...groups.entries()].map(([key, rows]) => {
    const first = rows[0]!;
    const at = rows.reduce((latest, row) => (row.submittedAt > latest ? row.submittedAt : latest), first.submittedAt);
    const who = first.teacherName;
    const where = first.requestTitle ? ` in ${first.requestTitle}` : "";
    return {
      key: `sub:${key}`,
      at,
      kind: "submitted",
      who,
      title: `${who ?? "A teacher"} answered ${plural(rows.length, "field")}${where}`,
      lines: rows.map((row) => describeSubmission(row)),
      href: `/requests/${first.requestId}`,
    };
  });
}

function describeSubmission(row: SubmissionRow): TimelineLine {
  const label = row.fieldLabel ?? row.fieldKey;
  const status =
    row.reviewStatus === "pending"
      ? "waiting for review"
      : row.reviewStatus === "approved"
        ? "approved"
        : row.reviewStatus === "rejected"
          ? "rejected"
          : row.reviewStatus === "applied"
            ? "recorded"
            : undefined;
  if (row.action === "confirmed") return { label, meta: "confirmed as correct" };
  if (row.action === "not_present") return { label, meta: "teacher says not in this class" };
  if (row.action === "absent") return { label, meta: "absent" };
  return {
    label,
    from: row.oldValue,
    to: row.newValue,
    meta: status,
    photo: row.inputType === "photo",
  };
}

function recordEvents(records: RecordRow[]): TimelineEvent[] {
  const groups = groupBy(records, (row) => `${row.requestId ?? "-"}|${row.createdAt.getTime()}`);
  return [...groups.entries()].map(([key, rows]) => {
    const first = rows[0]!;
    const marks = rows.every((row) => row.recordKind === FA_MARKS_KIND);
    const who = first.teacherName;
    const title = marks
      ? `${who ?? "Someone"} entered ${plural(rows.length, "mark")} for ${first.period}`
      : first.requestTitle
        ? `${who ?? "Someone"} answered${first.requestTitle ? ` "${first.requestTitle}"` : ""}`
        : `${plural(rows.length, "answer")} recorded`;
    return {
      key: `rec:${key}`,
      at: first.createdAt,
      kind: "recorded",
      who,
      title,
      lines: rows.map((row) => ({
        label: row.fieldLabel,
        to: row.value,
        meta: marks && row.maxValue ? `out of ${row.maxValue}` : undefined,
      })),
      href: first.requestId ? `/requests/${first.requestId}` : undefined,
    };
  });
}

function membershipEvents(memberships: MembershipRow[]): TimelineEvent[] {
  return memberships.map((row) => ({
    key: `req:${row.requestId}`,
    at: row.sentAt ?? row.createdAt,
    kind: "included",
    who: null,
    title: `Included in "${row.title}"`,
    lines: [
      {
        label: row.audienceLabel,
        meta: `${row.sentAt ? "sent" : "created"}${row.teacherName ? ` for ${row.teacherName}` : ""}${
          row.status !== "open" ? ` · ${row.status}` : ""
        }`,
      },
    ],
    href: `/requests/${row.requestId}`,
  }));
}

function documentEvents(documents: DocumentRow[]): TimelineEvent[] {
  return documents.flatMap((row) => {
    const what = row.label ? `${documentKindLabel(row.kind)} — ${row.label}` : documentKindLabel(row.kind);
    const added: TimelineEvent = {
      key: `doc:${row.id}`,
      at: row.uploadedAt,
      kind: "document_added",
      who: row.uploadedByName,
      title: `Document attached: ${what}`,
      lines: [],
    };
    if (!row.removedAt) return [added];
    return [
      added,
      {
        key: `doc-removed:${row.id}`,
        at: row.removedAt,
        kind: "document_removed",
        who: row.removedByName,
        title: `Document removed: ${what}`,
        lines: [],
      },
    ];
  });
}

export function mergeTimeline(parts: TimelineParts): TimelineEvent[] {
  const events = [
    ...logEvents(parts.log),
    ...submissionEvents(parts.submissions),
    ...recordEvents(parts.records),
    ...membershipEvents(parts.memberships),
    ...documentEvents(parts.documents),
  ];
  return events.sort(
    (a, b) =>
      b.at.getTime() - a.at.getTime() ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.key.localeCompare(b.key),
  );
}
