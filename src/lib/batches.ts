import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import {
  classesByRequest,
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
  planSubjectFanOut,
  type FanOutPlan,
  type Recipient,
  type RecipientMode,
  type GroupScope,
  type SubjectPick,
} from "./fanout";
import { subjectByFieldKey, type SubjectAssignment } from "./subjects";
import type { ScopeKind } from "./ownership";
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

/**
 * The cap exists so nobody fans out per-student by accident and mints five
 * hundred tokens. Nineteen classes used to be the real ceiling; a full marks
 * round sent to subject teachers is thirty-eight links, so forty was close
 * enough to a hard throw to be a trap.
 */
const MAX_GROUPS = 60;
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
  /**
   * Write the office's choices back, so the next round already knows them.
   *
   * Only ever ADDS, and only for a group that was blocked because NOBODY was
   * down for it. A group with two names against it is a choice for this round —
   * both people really do teach it, and dropping one on the strength of a send
   * would be a deletion nobody asked for.
   */
  remember?: boolean;
};

export const scopeKey = (scope: GroupScope) => `${scope.kind}|${scope.value}`;

export type BatchPreview = {
  plan: FanOutPlan;
  /** Everything the audience covers, before grouping. */
  audienceSize: number;
};

type Resolved = {
  plan: FanOutPlan;
  /**
   * The plan BEFORE the office's overrides were applied.
   *
   * Kept because `plan` has already moved every fixed group out of `blocked`,
   * and remembering an assignment needs to know what was missing in the first
   * place — which subject, which class, and that the reason really was
   * "nobody", not "two people". Taking that from the browser instead would be
   * trusting it with what to write; this is the server's own resolution.
   */
  rawPlan: FanOutPlan;
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
  const rawPlan =
    input.recipientMode === "subject_teacher"
      ? planSubjectFanOut(roster, teachers, await activeAssignments(), subjectsFor(fields))
      : planFanOut(roster, teachers, input.recipientMode);
  const plan = applyOverrides(rawPlan, teachers, input.overrides);

  if (plan.ready.length + plan.blocked.length > MAX_GROUPS) {
    throw new RequestValidationError(
      `That selection makes ${plan.ready.length + plan.blocked.length} separate links. Narrow it.`,
    );
  }

  return {
    plan,
    rawPlan,
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
    scope: GroupScope;
    teacherId: string;
    rosterSize: number;
  }[];
  /** The group that stopped the run, if one did. */
  failed: { scope: GroupScope; message: string } | null;
  /** Groups after it, untouched. Resume picks these up. */
  remaining: GroupScope[];
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

  // Before the links, not after: if runGroups fails half way the office still
  // keeps the assignments she just made, and Resume does not ask her for them a
  // second time. Nothing here can invalidate the plan — it only records what
  // was already used to build it.
  if (input.remember) await rememberChoices(resolved.rawPlan, input.overrides);

  return runGroups(batch.id, groups, resolved, input);
}

/**
 * Write back the teachers the office named on the preview.
 *
 * "Nobody is down for Physics in Class 9" is a gap in the records, not a fact
 * about this one send — so once she has answered it, the answer should still be
 * there next term. Otherwise the same dropdown gets filled in every round, and a
 * teacher who is genuinely missing from Settings stays missing forever because
 * the send screen keeps papering over it.
 *
 * ONLY `no-owner`, and only ADDING. A group blocked because two people are down
 * for it is a choice about this round: both really do teach it, and removing one
 * on the strength of a send is a deletion nobody asked for. A `no-phone` group's
 * override is a number for this request, which is already what contactPhone
 * means.
 *
 * Scopes come from the server's own pre-override plan, never from the browser —
 * the override says only WHICH teacher, exactly as it does for the roster.
 */
async function rememberChoices(
  rawPlan: FanOutPlan,
  overrides: BatchInput["overrides"],
): Promise<void> {
  if (!overrides) return;

  const subjectRows: (typeof schema.teacherSubjects.$inferInsert)[] = [];
  /** teacherId -> the class/house/route values to append to her row. */
  const scopeRows = new Map<string, { kind: ScopeKind; value: string }[]>();

  for (const group of rawPlan.blocked) {
    if (group.reason !== "no-owner") continue;
    const teacherId = overrides[scopeKey(group.scope)]?.teacherId;
    if (!teacherId) continue;

    if (group.scope.kind === "subject") {
      for (const classLabel of group.scope.classLabels) {
        subjectRows.push({
          teacherId,
          subjectKey: group.scope.subjectKey,
          classLabel,
          assignedBy: "office",
        });
      }
    } else {
      const list = scopeRows.get(teacherId) ?? [];
      list.push({ kind: group.scope.kind, value: group.scope.value });
      scopeRows.set(teacherId, list);
    }
  }

  if (subjectRows.length > 0) {
    // DoNothing, not DoUpdate: the row may already exist from the timetable
    // import, and its assignedBy should stay as it is.
    await db.insert(schema.teacherSubjects).values(subjectRows).onConflictDoNothing();
  }

  for (const [teacherId, additions] of scopeRows) {
    const [teacher] = await db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.id, teacherId));
    if (!teacher) continue;

    const next = {
      classes: [...teacher.classes],
      houses: [...teacher.houses],
      routes: [...teacher.routes],
    };
    for (const { kind, value } of additions) {
      const list =
        kind === "class" ? next.classes : kind === "house" ? next.houses : next.routes;
      if (!list.includes(value)) list.push(value);
    }
    await db.update(schema.teachers).set(next).where(eq(schema.teachers.id, teacherId));
  }
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
    existing.map((row) => scopeKey({ kind: row.kind as GroupScope["kind"], value: row.label } as GroupScope)),
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
  // Loaded for the WHOLE field set in one query. The map is keyed by (student,
  // fieldKey), so narrowing it per group costs nothing and reading it thirty
  // times is still one round trip rather than thirty.
  const priorRecords = await loadPriorRecords(
    resolved.roster,
    resolved.fields,
    resolved.period,
  );
  const batchKeys = normaliseFieldKeys(input.fieldKeys);
  const fieldsByKey = new Map(resolved.fields.map((field) => [field.key, field]));

  const created: FanOutResult["created"] = [];

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]!;
    const override = input.overrides?.[scopeKey(group.scope)];

    // The roster this group's teacher will actually see: the audience already
    // filtered, then cut to her own children. Never re-queried.
    const roster = group.studentIds
      .map((id) => resolved.byId.get(id))
      .filter((student): student is Student => Boolean(student));

    // A subject link asks about its own subject and nothing else. Every other
    // mode asks the whole batch's set, which is what an absent fieldKeys means.
    const groupKeys = group.fieldKeys ?? batchKeys;
    // Narrowed for the SNAPSHOT too, not only for the request row. The snapshot
    // is what the teacher was shown, and freezing sixteen subjects' prior marks
    // onto a link that asks about one would make that untrue.
    const groupFields = groupKeys
      .map((key) => fieldsByKey.get(key))
      .filter((field): field is FieldDef => Boolean(field));

    try {
      const result = await createOneRequest(
        {
          title: input.title,
          classLabel: group.scope.kind === "class" ? group.scope.value : null,
          audienceKind: group.scope.kind,
          audienceLabel: group.scope.value,
          batchId,
          teacherId: group.teacherId,
          fieldKeys: groupKeys,
          period: resolved.period,
          dueDate: input.dueDate,
          createdBy: input.createdBy,
          contactPhone: override?.contactPhone ?? null,
        },
        {
          roster,
          fields: groupFields,
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

/** Every subject assignment on record. ~90 rows; one query, no filter. */
async function activeAssignments(): Promise<SubjectAssignment[]> {
  return db
    .select({
      teacherId: schema.teacherSubjects.teacherId,
      subjectKey: schema.teacherSubjects.subjectKey,
      classLabel: schema.teacherSubjects.classLabel,
    })
    .from(schema.teacherSubjects);
}

/**
 * Which subjects this batch is about, derived from its field keys.
 *
 * DERIVED, not stored. The union of fa_* keys already has to sit in
 * request_batches.field_keys so resolveFields, resolvePeriod and
 * loadPriorRecords see the whole set, and a second column naming the subjects
 * would be a second home for the same fact — which is how a Resume days later
 * fans out over a different set of subjects than the original send did. Same
 * reasoning as the note on why `audience` is stored as ticked, not as resolved.
 */
function subjectsFor(fields: FieldDef[]): SubjectPick[] {
  return fields.flatMap((field) => {
    const subject = subjectByFieldKey(field.key);
    return subject
      ? [{ key: subject.key, en: subject.en, fieldKey: subject.fieldKey }]
      : [];
  });
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
  /** What this one link asks for. A subject link asks for exactly one. */
  fieldKeys: string[];
  teacherId: string;
  teacherName: string;
  /** Where it is going: her saved number, or the per-request override. */
  teacherPhone: string;
  /** Set only when the office overrode the number for THIS request. */
  contactPhone: string | null;
  /** Her durable page, when she has one. Rides along with the round's message. */
  teacherLinkToken: string | null;
  rosterSize: number;
  /**
   * Every class the frozen roster covers. Named in the message when there is
   * more than one — a subject link merges a teacher's classes into one screen.
   */
  classLabels: string[];
  sentAt: Date | null;
  /** open | submitted | closed | expired. What the LINK is doing. */
  status: string;
  /** Whether the office has already swept this one off the boards. */
  archivedAt: Date | null;
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
      fieldKeys: schema.requests.fieldKeys,
      teacherId: schema.requests.teacherId,
      teacherName: schema.teachers.name,
      teacherPhone: sql<string>`coalesce(nullif(${schema.requests.contactPhone}, ''), ${schema.teachers.phone})`,
      // Kept SEPARATE from the coalesced number above. The send queue groups by
      // recipient, and an overridden link must not merge into her saved-number
      // card — that would send it to the wrong phone.
      contactPhone: schema.requests.contactPhone,
      teacherLinkToken: schema.teachers.linkToken,
      sentAt: schema.requests.sentAt,
      createdAt: schema.requests.createdAt,
      // Carried so the batch page can offer the same clear-up the requests
      // board does. A round is worked through here, and it is here that
      // somebody wants to sweep it away afterwards — sending them back to a
      // nineteen-row table to tick the same nineteen rows again is the reason
      // finished rounds sit on the board for months.
      status: schema.requests.status,
      archivedAt: schema.requests.archivedAt,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(eq(schema.requests.batchId, batchId))
    .orderBy(asc(schema.requests.createdAt));

  const ids = rows.map((row) => row.requestId);
  const [sizes, classes] = await Promise.all([
    rosterSizes(ids),
    classesByRequest(ids),
  ]);

  const links = rows.map((row) => ({
    requestId: row.requestId,
    token: row.token,
    audienceKind: row.audienceKind,
    audienceLabel: row.audienceLabel,
    fieldKeys: row.fieldKeys,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
    teacherPhone: row.teacherPhone,
    contactPhone: row.contactPhone,
    teacherLinkToken: row.teacherLinkToken,
    rosterSize: sizes.get(row.requestId) ?? 0,
    classLabels: classes.get(row.requestId) ?? [],
    sentAt: row.sentAt,
    status: row.status,
    archivedAt: row.archivedAt,
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

/**
 * Tick — or untick — every link the office handed over in ONE message.
 *
 * The grouped queue sends a teacher all of her links at once, so all of them
 * are equally sent; ticking one and not the others would be a state the message
 * itself cannot produce. Reversible for the same reason the single tick is.
 *
 * One statement rather than N, because a teacher with three links should not
 * cost three round trips to acknowledge.
 */
export async function markGroupSent(
  requestIds: string[],
  userId: string,
  sent: boolean,
): Promise<void> {
  if (requestIds.length === 0) return;
  await db
    .update(schema.requests)
    .set(
      sent
        ? { sentAt: new Date(), sentBy: userId }
        : { sentAt: null, sentBy: null },
    )
    .where(inArray(schema.requests.id, requestIds));
}
