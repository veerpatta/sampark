import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * What has happened lately, across the whole school.
 *
 * The dashboard's counts say how much is outstanding; this says what moved.
 * Three reads, each already grouped in SQL — a review batch is one line, a
 * teacher's flush is one line, a round handed over is one line — and a pure
 * merge that sorts and trims. Every line links to the screen that shows it.
 */

export type ActivityKind = "approved" | "rejected" | "edited" | "created" | "answered" | "sent";

export type ActivityEvent = {
  key: string;
  at: Date;
  kind: ActivityKind;
  who: string | null;
  title: string;
  href: string;
};

export type DecisionGroup = {
  decidedByName: string;
  decision: string;
  minute: Date;
  rows: number;
  students: number;
  latest: Date;
};

export type AnswerGroup = {
  requestId: string;
  requestTitle: string;
  audienceLabel: string;
  teacherName: string | null;
  hour: Date;
  rows: number;
  latest: Date;
};

export type SendRow = {
  requestId: string;
  title: string;
  audienceLabel: string;
  teacherName: string;
  sentByName: string | null;
  sentAt: Date;
};

export async function recentActivity(limit = 20): Promise<ActivityEvent[]> {
  const [decisions, answers, sends] = await Promise.all([
    db
      .select({
        decidedByName: schema.users.name,
        decision: schema.changeLog.decision,
        minute: sql<Date>`date_trunc('minute', ${schema.changeLog.decidedAt})`,
        rows: sql<number>`count(*)::int`,
        students: sql<number>`count(distinct ${schema.changeLog.studentId})::int`,
        latest: sql<Date>`max(${schema.changeLog.decidedAt})`,
      })
      .from(schema.changeLog)
      .innerJoin(schema.users, eq(schema.users.id, schema.changeLog.decidedBy))
      .groupBy(schema.users.name, schema.changeLog.decision, sql`date_trunc('minute', ${schema.changeLog.decidedAt})`)
      .orderBy(desc(sql`max(${schema.changeLog.decidedAt})`))
      .limit(limit),
    db
      .select({
        requestId: schema.submissions.requestId,
        requestTitle: schema.requests.title,
        audienceLabel: schema.requests.audienceLabel,
        teacherName: schema.teachers.name,
        hour: sql<Date>`date_trunc('hour', ${schema.submissions.submittedAt})`,
        rows: sql<number>`count(*)::int`,
        latest: sql<Date>`max(${schema.submissions.submittedAt})`,
      })
      .from(schema.submissions)
      .innerJoin(schema.requests, eq(schema.requests.id, schema.submissions.requestId))
      .leftJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .groupBy(
        schema.submissions.requestId,
        schema.requests.title,
        schema.requests.audienceLabel,
        schema.teachers.name,
        sql`date_trunc('hour', ${schema.submissions.submittedAt})`,
      )
      .orderBy(desc(sql`max(${schema.submissions.submittedAt})`))
      .limit(limit),
    db
      .select({
        requestId: schema.requests.id,
        title: schema.requests.title,
        audienceLabel: schema.requests.audienceLabel,
        teacherName: schema.teachers.name,
        sentByName: schema.users.name,
        sentAt: schema.requests.sentAt,
      })
      .from(schema.requests)
      .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .leftJoin(schema.users, eq(schema.users.id, schema.requests.sentBy))
      .where(isNotNull(schema.requests.sentAt))
      .orderBy(desc(schema.requests.sentAt))
      .limit(limit),
  ]);

  return mergeActivity(
    decisions.map((row) => ({ ...row, minute: new Date(row.minute), latest: new Date(row.latest) })),
    answers.map((row) => ({ ...row, hour: new Date(row.hour), latest: new Date(row.latest) })),
    sends.map((row) => ({ ...row, sentAt: row.sentAt! })),
    limit,
  );
}

/* ---------------------------------------------------------------- pure */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function mergeActivity(
  decisions: DecisionGroup[],
  answers: AnswerGroup[],
  sends: SendRow[],
  limit = 20,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const group of decisions) {
    const kind: ActivityKind =
      group.decision === "approved"
        ? "approved"
        : group.decision === "rejected"
          ? "rejected"
          : group.decision === "created"
            ? "created"
            : "edited";
    const title =
      kind === "approved"
        ? `approved ${plural(group.rows, "change")} for ${plural(group.students, "student")}`
        : kind === "rejected"
          ? `rejected ${plural(group.rows, "proposed change")}`
          : kind === "created"
            ? `added ${plural(group.students, "student")}`
            : `edited ${plural(group.rows, "field")} on ${plural(group.students, "student")}`;
    events.push({
      key: `dec:${group.decidedByName}|${group.decision}|${group.minute.getTime()}`,
      at: group.latest,
      kind,
      who: group.decidedByName,
      title,
      href: kind === "rejected" || kind === "approved" ? "/settings/audit" : "/settings/audit",
    });
  }

  for (const group of answers) {
    events.push({
      key: `ans:${group.requestId}|${group.hour.getTime()}`,
      at: group.latest,
      kind: "answered",
      who: group.teacherName,
      title: `answered ${plural(group.rows, "field")} in ${group.requestTitle} (${group.audienceLabel})`,
      href: `/requests/${group.requestId}`,
    });
  }

  for (const row of sends) {
    events.push({
      key: `sent:${row.requestId}`,
      at: row.sentAt,
      kind: "sent",
      who: row.sentByName,
      title: `sent ${row.title} (${row.audienceLabel}) to ${row.teacherName}`,
      href: `/requests/${row.requestId}`,
    });
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key)).slice(0, limit);
}
