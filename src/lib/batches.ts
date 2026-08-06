import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import {
  createOneRequest,
  loadPriorRecords,
  normaliseFieldKeys,
  RequestValidationError,
  resolveFields,
  resolvePeriod,
  uniqueTokens,
} from "./requests";
import { listAudienceRoster, type Audience } from "./students";
import {
  isRecipientMode,
  planFanOut,
  type FanOutPlan,
  type Recipient,
  type RecipientMode,
} from "./fanout";
import type { Scope } from "./ownership";
import type { FieldDef, Student } from "../../drizzle/schema";

/**
 * One question, asked of many groups.
 *
 * A request stays one token, one frozen roster, one recipient — that shape is
 * load bearing and is not being changed here. This module is what turns "ask
 * every class for phone numbers" into nineteen of them and keeps them together
 * afterwards.
 *
 * THE FAN-OUT IS NOT ONE TRANSACTION, DELIBERATELY.
 *
 * Per-request atomicity is kept: createOneRequest still deletes its own request
 * row if the roster insert fails, so no link ever opens to an empty list. But if
 * link seven of eleven fails, the first six are KEPT. Six live tokens with
 * frozen rosters are six classes the office can send to right now; deleting them
 * to satisfy an all-or-nothing aesthetic destroys real work and buys nothing,
 * because the office would simply do it again. The batch reports what is missing
 * and Resume finishes the job.
 *
 * Sequential, not Promise.all. Nineteen concurrent Neon HTTP bursts each doing
 * chunked roster inserts is how you meet a connection cap, and going in order
 * means a failure stops at a known point rather than somewhere in the middle of
 * nineteen half-finished writes.
 */

/** Nineteen classes is the real ceiling. The cap is here so nobody fans out
 *  per-student by accident and mints five hundred tokens. */
const MAX_GROUPS = 40;
const MAX_STUDENTS = 3000;

export type BatchInput = {
  title: string;
  audience: Audience;
  fieldKeys: string[];
  period?: string | null;
  dueDate: string;
  recipientMode: RecipientMode;
  createdBy: string;
  /**
   * Fixes the office made on the preview screen, keyed by `kind|value`: a
   * teacher chosen for a group with two owners or none, and a number typed for
   * one who has none saved.
   */
  overrides?: Record<string, { teacherId?: string; contactPhone?: string }>;
  /** Groups she explicitly chose to go ahead without. */
  skip?: string[];
};

export const scopeKey = (scope: Scope) => `${scope.kind}|${scope.value}`;

export type BatchPreview = {
  plan: FanOutPlan;
  /** Everything the audience covers, before grouping. */
  audienceSize: number;
};

type Resolved = {
  plan: FanOutPlan;
  roster: Student[];
  fields: FieldDef[];
  period: string | null;
  byId: Map<string, Student>;
};

/**
 * Work out what would be created, without creating anything.
 *
 * The preview is a server call rather than something the browser assembles,
 * because only the server can resolve the audience — and the number the office
 * is shown has to be the number that gets frozen.
 */
export async function previewBatch(input: BatchInput): Promise<BatchPreview> {
  const resolved = await resolveBatch(input);
  return { plan: resolved.plan, audienceSize: resolved.roster.length };
}

async function resolveBatch(
  input: BatchInput,
  /**
   * The batch this will belong to, once there is one. Absent while previewing,
   * where the period is never written — and the id of a batch, not of a
   * request, so one question asked of nineteen classes lands in ONE period
   * rather than nineteen.
   */
  scopeId?: string,
): Promise<Resolved> {
  if (!isRecipientMode(input.recipientMode)) {
    throw new RequestValidationError("Choose who the links should go to.");
  }

  const fields = await resolveFields(normaliseFieldKeys(input.fieldKeys));
  const period = resolvePeriod(fields, input.period, scopeId);
  const roster = await listAudienceRoster(input.audience);

  if (roster.length === 0) {
    throw new RequestValidationError(
      "That selection covers no active students. Widen it, or check the class list.",
    );
  }
  if (roster.length > MAX_STUDENTS) {
    throw new RequestValidationError(
      `That selection covers ${roster.length} students, more than a single send is meant to carry.`,
    );
  }

  const teachers = await activeRecipients();
  const plan = applyOverrides(
    planFanOut(roster, teachers, input.recipientMode),
    teachers,
    input.overrides,
  );

  if (plan.ready.length + plan.blocked.length > MAX_GROUPS) {
    throw new RequestValidationError(
      `That selection makes ${plan.ready.length + plan.blocked.length} separate links. Narrow it.`,
    );
  }

  return {
    plan,
    roster,
    fields,
    period,
    byId: new Map(roster.map((student) => [student.id, student])),
  };
}

/**
 * Move groups the office fixed on the preview out of `blocked` and into `ready`.
 *
 * Applied to the freshly computed plan rather than trusted from the browser:
 * the override says only WHICH teacher, and the roster it will carry is still
 * the one the server just resolved.
 */
function applyOverrides(
  plan: FanOutPlan,
  teachers: Recipient[],
  overrides: BatchInput["overrides"],
): FanOutPlan {
  if (!overrides || Object.keys(overrides).length === 0) return plan;

  const ready = [...plan.ready];
  const blocked: typeof plan.blocked = [];

  for (const group of plan.blocked) {
    const override = overrides[scopeKey(group.scope)];
    // A no-phone block already has its one owner; the others have none, and the
    // override is where the office named someone.
    const { choice } = group;
    const teacherId =
      override?.teacherId ?? (choice.kind === "one" ? choice.teacherId : null);
    const teacher = teacherId
      ? teachers.find((row) => row.id === teacherId)
      : undefined;

    // A typed number rescues a teacher with none saved; it cannot conjure a
    // teacher where none was chosen.
    if (!teacher) {
      blocked.push(group);
      continue;
    }
    if (!teacher.phone && !override?.contactPhone) {
      blocked.push(group);
      continue;
    }

    ready.push({
      ...group,
      teacherId: teacher.id,
      teacherName: teacher.name,
    });
  }

  const covered = ready.reduce((sum, group) => sum + group.studentIds.length, 0);
  const stillBlocked = blocked.reduce(
    (sum, group) => sum + group.studentIds.length,
    0,
  );

  return {
    ready,
    blocked,
    unassigned: plan.unassigned,
    totals: {
      links: ready.length,
      students: covered,
      skipped: stillBlocked + plan.unassigned.length,
    },
  };
}

export type FanOutResult = {
  batchId: string;
  created: {
    requestId: string;
    token: string;
    scope: Scope;
    teacherId: string;
    rosterSize: number;
  }[];
  /** The group that stopped the run, if one did. */
  failed: { scope: Scope; message: string } | null;
  /** Groups after it, untouched. Resume picks these up. */
  remaining: Scope[];
};

export async function createBatch(input: BatchInput): Promise<FanOutResult> {
  // Pre-generated so the period for an ad-hoc question can be derived before
  // anything is written, and so validation still runs before the batch row
  // exists rather than leaving an empty batch behind when it fails.
  const batchId = randomUUID();
  const resolved = await resolveBatch(input, batchId);
  const skip = new Set(input.skip ?? []);
  const groups = resolved.plan.ready.filter(
    (group) => !skip.has(scopeKey(group.scope)),
  );

  if (groups.length === 0) {
    throw new RequestValidationError(
      "Nothing to send — every group is either skipped or waiting on a teacher.",
    );
  }

  const [batch] = await db
    .insert(schema.requestBatches)
    .values({
      id: batchId,
      title: input.title.trim(),
      audience: input.audience,
      fieldKeys: normaliseFieldKeys(input.fieldKeys),
      period: resolved.period,
      dueDate: input.dueDate,
      recipientMode: input.recipientMode,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.requestBatches.id });

  if (!batch) throw new Error("Batch insert returned nothing.");

  return runGroups(batch.id, groups, resolved, input);
}

/**
 * Finish a batch that stopped part way.
 *
 * Re-resolves the audience from the stored row and creates only the groups that
 * have no request yet. Two things make this safe to tap twice: the scopes
 * already present are skipped, and `requests_batch_scope_idx` turns a genuine
 * race into a database error rather than a second token for a group that
 * already has one.
 */
export async function resumeBatch(
  batchId: string,
  createdBy: string,
): Promise<FanOutResult> {
  const [batch] = await db
    .select()
    .from(schema.requestBatches)
    .where(eq(schema.requestBatches.id, batchId))
    .limit(1);

  if (!batch) throw new RequestValidationError("That batch does not exist.");

  const input: BatchInput = {
    title: batch.title,
    audience: batch.audience as Audience,
    fieldKeys: batch.fieldKeys,
    period: batch.period,
    dueDate: batch.dueDate,
    recipientMode: batch.recipientMode as RecipientMode,
    createdBy,
  };

  const resolved = await resolveBatch(input, batchId);

  const existing = await db
    .select({
      kind: schema.requests.audienceKind,
      label: schema.requests.audienceLabel,
    })
    .from(schema.requests)
    .where(eq(schema.requests.batchId, batchId));

  const done = new Set(
    existing.map((row) => scopeKey({ kind: row.kind as Scope["kind"], value: row.label })),
  );
  const groups = resolved.plan.ready.filter(
    (group) => !done.has(scopeKey(group.scope)),
  );

  if (groups.length === 0) {
    return { batchId, created: [], failed: null, remaining: [] };
  }

  return runGroups(batchId, groups, resolved, input);
}

/** The sequential loop. Stops at the first failure and reports where. */
async function runGroups(
  batchId: string,
  groups: FanOutPlan["ready"],
  resolved: Resolved,
  input: BatchInput,
): Promise<FanOutResult> {
  const tokens = await uniqueTokens(groups.length);
  const priorRecords = await loadPriorRecords(
    resolved.roster,
    resolved.fields,
    resolved.period,
  );

  const created: FanOutResult["created"] = [];

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]!;
    const override = input.overrides?.[scopeKey(group.scope)];

    // The roster this group's teacher will actually see: the audience already
    // filtered, then cut to her own children. Never re-queried.
    const roster = group.studentIds
      .map((id) => resolved.byId.get(id))
      .filter((student): student is Student => Boolean(student));

    try {
      const result = await createOneRequest(
        {
          title: input.title,
          classLabel: group.scope.kind === "class" ? group.scope.value : null,
          audienceKind: group.scope.kind,
          audienceLabel: group.scope.value,
          batchId,
          teacherId: group.teacherId,
          fieldKeys: normaliseFieldKeys(input.fieldKeys),
          period: resolved.period,
          dueDate: input.dueDate,
          createdBy: input.createdBy,
          contactPhone: override?.contactPhone ?? null,
        },
        {
          roster,
          fields: resolved.fields,
          priorRecords,
          token: tokens[i]!,
          requestId: randomUUID(),
        },
      );

      created.push({
        requestId: result.id,
        token: result.token,
        scope: group.scope,
        teacherId: group.teacherId,
        rosterSize: result.rosterSize,
      });
    } catch (error) {
      return {
        batchId,
        created,
        failed: {
          scope: group.scope,
          message:
            error instanceof Error ? error.message : "Could not create the link.",
        },
        remaining: groups.slice(i + 1).map((row) => row.scope),
      };
    }
  }

  return { batchId, created, failed: null, remaining: [] };
}

async function activeRecipients(): Promise<Recipient[]> {
  const rows = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.active, true))
    .orderBy(asc(schema.teachers.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    classes: row.classes,
    houses: row.houses,
    routes: row.routes,
  }));
}

/* -------------------------------------------------------------- the queue */

export type BatchLink = {
  requestId: string;
  token: string;
  audienceKind: string;
  audienceLabel: string;
  teacherName: string;
  teacherPhone: string;
  rosterSize: number;
  sentAt: Date | null;
};

export type BatchDetail = {
  batch: typeof schema.requestBatches.$inferSelect;
  links: BatchLink[];
  sent: number;
};

/** Everything the send queue renders, in the order it should be worked through. */
export async function getBatch(batchId: string): Promise<BatchDetail | null> {
  const [batch] = await db
    .select()
    .from(schema.requestBatches)
    .where(eq(schema.requestBatches.id, batchId))
    .limit(1);

  if (!batch) return null;

  const rows = await db
    .select({
      requestId: schema.requests.id,
      token: schema.requests.token,
      audienceKind: schema.requests.audienceKind,
      audienceLabel: schema.requests.audienceLabel,
      teacherName: schema.teachers.name,
      teacherPhone: sql<string>`coalesce(nullif(${schema.requests.contactPhone}, ''), ${schema.teachers.phone})`,
      sentAt: schema.requests.sentAt,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(eq(schema.requests.batchId, batchId))
    .orderBy(asc(schema.requests.createdAt));

  const sizes = await rosterSizes(rows.map((row) => row.requestId));

  const links = rows.map((row) => ({
    requestId: row.requestId,
    token: row.token,
    audienceKind: row.audienceKind,
    audienceLabel: row.audienceLabel,
    teacherName: row.teacherName,
    teacherPhone: row.teacherPhone,
    rosterSize: sizes.get(row.requestId) ?? 0,
    sentAt: row.sentAt,
  }));

  return {
    batch,
    links,
    sent: links.filter((link) => link.sentAt !== null).length,
  };
}

async function rosterSizes(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      requestId: schema.requestStudents.requestId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.requestStudents)
    .where(inArray(schema.requestStudents.requestId, ids))
    .groupBy(schema.requestStudents.requestId);
  return new Map(rows.map((row) => [row.requestId, row.n]));
}

/**
 * Record that a link was actually handed over.
 *
 * Server state, so the queue survives finishing on a different device. Set and
 * unset by the same call, because the tick is tappable to undo — "opened
 * WhatsApp" is the closest thing to proof we can get, and being able to take it
 * back is what makes treating it as sent honest.
 */
export async function markSent(
  requestId: string,
  userId: string,
  sent: boolean,
): Promise<void> {
  await db
    .update(schema.requests)
    .set(
      sent
        ? { sentAt: new Date(), sentBy: userId }
        : { sentAt: null, sentBy: null },
    )
    .where(eq(schema.requests.id, requestId));
}

/** Batches for the board, newest first, with how far each has been sent. */
export async function listBatches(limit = 20) {
  const batches = await db
    .select()
    .from(schema.requestBatches)
    .orderBy(sql`${schema.requestBatches.createdAt} desc`)
    .limit(limit);

  if (batches.length === 0) return [];

  const counts = await db
    .select({
      batchId: schema.requests.batchId,
      links: sql<number>`count(*)::int`,
      sent: sql<number>`count(${schema.requests.sentAt})::int`,
    })
    .from(schema.requests)
    .where(
      and(
        isNotNull(schema.requests.batchId),
        inArray(
          schema.requests.batchId,
          batches.map((batch) => batch.id),
        ),
      ),
    )
    .groupBy(schema.requests.batchId);

  const byId = new Map(counts.map((row) => [row.batchId!, row]));

  return batches.map((batch) => ({
    ...batch,
    links: byId.get(batch.id)?.links ?? 0,
    sent: byId.get(batch.id)?.sent ?? 0,
  }));
}
