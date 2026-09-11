import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
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
import { listAudienceRoster, normaliseAudience, type Audience } from "./students";
import {
  getOfficeRecipient,
  MASTER_AUDIENCE_KIND,
  OFFICE_AUDIENCE_LABEL,
  listPickableTeachers,
} from "./office";
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
  /**
   * Why these children, when the group label alone would be a lie.
   *
   * Either the office's own typed sentence or one derived from the gaps it
   * filtered on — see describeGaps in lib/student-filters.ts. Both halves are
   * stored, because the teacher surface is bilingual and deriving Hindi from
   * English after the fact is not a thing this app can do.
   */
  reason?: { en: string; hi: string } | null;
  /** A line about one child, by student id. From an uploaded list. */
  notes?: Record<string, string>;
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
  /** The audience as it was actually resolved, after normaliseAudience. */
  audience: Audience;
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
  const audience = normaliseAudience(input.audience);
  const roster = await listAudienceRoster(audience);

  if (roster.length === 0) {
    /*
     * AN EMPTY GAP SELECTION IS GOOD NEWS, and must not read as a mistake.
     *
     * "Widen it, or check the class list" is the right sentence for a class
     * nobody has imported yet. It is exactly the wrong one for "every child in
     * Class 8 already has a photograph" — that is the office being told to undo
     * the work it just finished, over the one result the whole feature exists
     * to produce.
     */
    throw new RequestValidationError(
      (audience.gaps?.length ?? 0) > 0
        ? "Nothing is missing in that selection — every child there already has what you are asking for."
        : audience.studentIds?.length
          ? "None of those children is on the active roll any more."
          : "That selection covers no active students. Widen it, or check the class list.",
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
    audience,
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
  /**
   * The round's own link, or null when it has none.
   *
   * Null is an ordinary outcome, not a failure: a subject round gets no master
   * link, and neither does a round created before anybody set the office's
   * number. The caller says so on screen rather than treating it as an error.
   */
  master: { requestId: string; token: string; rosterSize: number } | null;
};

/**
 * Add the master link to a finished fan-out, and never let it break one.
 *
 * The round is the thing that matters. Seven links of eleven is seven teachers
 * who can start; the same run losing all eleven because the office's number was
 * malformed would be the tail wagging the dog.
 */
async function withMasterLink(
  result: Omit<FanOutResult, "master">,
  createdBy: string,
): Promise<FanOutResult> {
  try {
    return {
      ...result,
      master: await ensureMasterLink({ batchId: result.batchId, createdBy }),
    };
  } catch (error) {
    console.error("Master link could not be minted", error);
    return { ...result, master: null };
  }
}

/**
 * The audience as it will be stored: the ids it actually resolved to.
 *
 * THIS REVERSES WHAT THE SCHEMA COMMENT ON request_batches.audience SAYS, on
 * purpose and only here. "The office's selection as given, not the resolved
 * roster" is right for a class, a house or a route: Class 8 is still Class 8 on
 * Thursday, so a Resume re-resolving it finishes the job it started.
 *
 * A GAP AUDIENCE IS DEFINED BY THE ABSENCE OF THE VERY DATA THE ROUND IS
 * COLLECTING. Six photographs arrive overnight; Resume re-resolves; the links
 * it creates cover a different, smaller set than the ones it is finishing, and
 * a class whose last photo-less child was photographed gets no link at all
 * while the board still counts nineteen groups. ensureMasterLink reads the same
 * column, so the round's own link would cover a set its class links do not.
 *
 * Frozen for every audience, not only a gap one, because "Resume finishes what
 * the send started" is what the button claims in all of them — and a child
 * imported into Class 8 after the send was not on the other teachers' frozen
 * rosters either.
 *
 * `from` keeps what she ticked, so the round's page can still say "no photo,
 * Classes 6 to 8" rather than reading back five hundred ids.
 */
function freezeAudience(resolved: Resolved, input: BatchInput): Audience {
  const notes = input.notes ?? resolved.audience.notes;
  if (resolved.audience.studentIds?.length) {
    return { ...resolved.audience, notes };
  }
  return {
    studentIds: resolved.roster.map((student) => student.id),
    from: resolved.audience,
    notes,
  };
}

/** The stored per-child notes, in the shape createOneRequest wants. */
function noteMap(audience: Audience): Map<string, string> | undefined {
  return audience.notes ? new Map(Object.entries(audience.notes)) : undefined;
}

/** The reason as the two columns hold it, or null when the round has none. */
function reasonOf(batch: {
  reasonEn: string | null;
  reasonHi: string | null;
}): { en: string; hi: string } | null {
  if (!batch.reasonEn && !batch.reasonHi) return null;
  return { en: batch.reasonEn ?? "", hi: batch.reasonHi ?? "" };
}

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
      audience: freezeAudience(resolved, input),
      fieldKeys: normaliseFieldKeys(input.fieldKeys),
      period: resolved.period,
      dueDate: input.dueDate,
      recipientMode: input.recipientMode,
      createdBy: input.createdBy,
      reasonEn: input.reason?.en ?? null,
      reasonHi: input.reason?.hi ?? null,
    })
    .returning({ id: schema.requestBatches.id });

  if (!batch) throw new Error("Batch insert returned nothing.");

  // Before the links, not after: if runGroups fails half way the office still
  // keeps the assignments she just made, and Resume does not ask her for them a
  // second time. Nothing here can invalidate the plan — it only records what
  // was already used to build it.
  if (input.remember) await rememberChoices(resolved.rawPlan, input.overrides);

  return withMasterLink(
    await runGroups(batch.id, groups, resolved, input),
    input.createdBy,
  );
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
    // Carried forward so a link created by Resume says exactly what the links
    // created by the send it is finishing say.
    reason: reasonOf(batch),
    notes: (batch.audience as Audience).notes,
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

  // Every group already has its link — but the master may still be missing,
  // from a round created before the office had a number. Resume is the button
  // that finishes a round, so it finishes this too.
  if (groups.length === 0) {
    return withMasterLink(
      { batchId, created: [], failed: null, remaining: [] },
      createdBy,
    );
  }

  return withMasterLink(
    await runGroups(batchId, groups, resolved, input),
    createdBy,
  );
}

/**
 * Mint the round's own link: one token over every group's roster.
 *
 * WHY A ROUND NEEDS ONE. The fan-out's whole shape is "one link per teacher",
 * and it is the right shape — a teacher checks her own register and nobody
 * else's. What it has no answer for is the end of a round: eighteen classes in,
 * forty children left, spread six here and four there across five teachers who
 * have stopped reading WhatsApp. Chasing those five costs more than doing the
 * forty. This is the link that lets the office do them.
 *
 * IT IS AN ORDINARY REQUEST ROW, and that is the entire trick. audience_kind is
 * plain text, so `master` cost no migration; and because the row is ordinary,
 * resolveToken opens it, the submit and photo routes accept it, the rate limits
 * and security headers cover it, the offline queue works on it, every answer
 * lands in the same review queue, and the WhatsApp button routes to it through
 * /w/<token> with no template re-approval. Nothing on the teacher surface knows
 * this feature exists.
 *
 * ONE PER ROUND IS A DATABASE GUARANTEE, not a check. The label is the constant
 * OFFICE_AUDIENCE_LABEL, so requests_batch_scope_idx — unique on (batch_id,
 * audience_kind, audience_label) — is what makes this safe to call from both
 * createBatch and resumeBatch and safe to race with itself. A second call finds
 * the row that already exists and returns it.
 *
 * IT NEVER FAILS THE ROUND. A fan-out is deliberately not one transaction
 * (see the note at the head of this file): eleven links of which seven were
 * created is seven teachers who can start. A master link that could not be
 * minted must be exactly as survivable — the round is the thing that matters,
 * and the office can mint this one from the round's page afterwards.
 */
export async function ensureMasterLink(input: {
  batchId: string;
  createdBy: string;
}): Promise<{ requestId: string; token: string; rosterSize: number } | null> {
  const [batch] = await db
    .select()
    .from(schema.requestBatches)
    .where(eq(schema.requestBatches.id, input.batchId))
    .limit(1);
  if (!batch) return null;

  const existing = await findMasterLink(input.batchId);
  if (existing) return existing;

  /*
   * A SUBJECT ROUND GETS NO MASTER LINK.
   *
   * Every other mode asks one question of every child, so one screen over the
   * whole audience is a list somebody can actually work through. A subject
   * round asks a different question per group — Hemlata's link carries
   * Chemistry and nobody else's — so its master would be sixteen subjects
   * against five hundred children, which is not a screen, and whose marks the
   * office has no way to know anyway. The fan-out already refuses to guess who
   * teaches what; this refuses to pretend the office does.
   */
  if (batch.recipientMode === "subject_teacher") return null;

  const office = await getOfficeRecipient();
  // No number set yet. Not an error: the round is fine, and Settings → Office
  // is one screen away. Minting a link nobody can be sent would only hide that.
  if (!office) return null;

  const roster = await listAudienceRoster(batch.audience as Audience);
  if (roster.length === 0) return null;

  const fieldKeys = normaliseFieldKeys(batch.fieldKeys);
  const fields = await resolveFields(fieldKeys);
  const [token] = await uniqueTokens(1);

  try {
    const created = await createOneRequest(
      {
        title: batch.title,
        // NULL exactly as a house or route link's is: this roster spans every
        // class, so a column that joins students.class_label cannot be true.
        classLabel: null,
        audienceKind: MASTER_AUDIENCE_KIND,
        audienceLabel: OFFICE_AUDIENCE_LABEL,
        batchId: batch.id,
        teacherId: office.id,
        fieldKeys,
        period: batch.period,
        dueDate: batch.dueDate,
        createdBy: input.createdBy,
        // The office's own link says what the teachers' links say. It is the
        // alternative to working through them, not a different question.
        reason: reasonOf(batch),
      },
      {
        roster,
        fields,
        priorRecords: await loadPriorRecords(roster, fields, batch.period),
        token: token!,
        requestId: randomUUID(),
        notes: noteMap(batch.audience as Audience),
      },
    );
    return {
      requestId: created.id,
      token: created.token,
      rosterSize: created.rosterSize,
    };
  } catch {
    // Lost a race with another tab, most likely — the unique index did its job.
    // Whatever the cause, the round stands and the office can mint from the
    // round's page. Return whatever is actually there now.
    return findMasterLink(input.batchId);
  }
}

/** The round's master link, or null for a round that has none. */
export async function findMasterLink(batchId: string): Promise<{
  requestId: string;
  token: string;
  rosterSize: number;
  /** When it was last handed over. Null until the first successful send. */
  sentAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      requestId: schema.requests.id,
      token: schema.requests.token,
      sentAt: schema.requests.sentAt,
      rosterSize: sql<number>`(
        select count(*)::int from ${schema.requestStudents}
        where ${schema.requestStudents.requestId} = ${schema.requests.id}
      )`,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.batchId, batchId),
        eq(schema.requests.audienceKind, MASTER_AUDIENCE_KIND),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The sequential loop. Stops at the first failure and reports where. */
async function runGroups(
  batchId: string,
  groups: FanOutPlan["ready"],
  resolved: Resolved,
  input: BatchInput,
): Promise<Omit<FanOutResult, "master">> {
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
  // Built once for the whole round. createOneRequest looks up only the children
  // in its own group, so one map serves all nineteen links.
  const notes = input.notes
    ? new Map(Object.entries(input.notes))
    : noteMap(resolved.audience);

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
          // The SAME reason on every link in the round, including the master
          // one. It says why the round exists, which does not change per group
          // — and a per-group count would have to be recomputed in the message
          // builder anyway, which is where the group's own size already lives.
          reason: input.reason ?? null,
        },
        {
          roster,
          fields: groupFields,
          priorRecords,
          token: tokens[i]!,
          requestId: randomUUID(),
          notes,
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
  // Not the office: its classes, houses and routes are all empty so ownedBy
  // could never select it anyway, but a candidate list is also what the blocked-
  // group override dropdown is built from, and "Office" offered there is one
  // mistap from sending Class 8's link to the wrong phone. See lib/office.ts.
  const rows = await listPickableTeachers();

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
  /** open | submitted | closed. What the link is doing. */
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
    .where(
      and(
        eq(schema.requests.batchId, batchId),
        // NOT THE MASTER LINK. This queue is one card per person to chase, and
        // the office is not one of them — a card called "Office" sitting among
        // the teachers would make a two-class round read as three links, put a
        // Remind button against the people doing the reminding, and disagree
        // with the round's own progress line, which counts groups. The master
        // link has its own card above the queue; see MasterLinkCard.
        ne(schema.requests.audienceKind, MASTER_AUDIENCE_KIND),
      ),
    )
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
  /** Null when the app sent it itself, with nobody signed in — a cron. */
  userId: string | null,
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

/**
 * Record that the office chased her about these links — or take it back.
 *
 * The same shape as markGroupSent, because the message is the same shape: one
 * nudge carries everything she still owes, so every link it named was equally
 * chased and ticking one without the others is a state the message cannot
 * produce.
 *
 * WHAT MAKES IT DIFFERENT FROM `sent` IS THAT IT REPEATS. Handing a link over
 * happens once; chasing it happens again every week the answers do not arrive.
 * So `reminded_at` is the most recent nudge and `reminder_count` counts them,
 * incremented in SQL rather than read-then-written — two people chasing the same
 * teacher from two corridors is exactly the race this feature exists to reduce,
 * and it should not be able to lose a count while doing it.
 *
 * THE UNTICK IS GUARDED TO TODAY, AND THE GUARD IS HERE RATHER THAN ON THE
 * SCREEN. The queue only ever offers an untick beside a tick it is already
 * showing, and it only shows today's — but a tab left open overnight would still
 * be holding a button that, unguarded, would erase a date the office is now
 * relying on and decrement a count that was never today's. A stale click on a
 * stale tab does nothing instead.
 */
export async function markGroupReminded(
  requestIds: string[],
  /** Null when the app sent it itself, with nobody signed in — a cron. */
  userId: string | null,
  reminded: boolean,
  /** Today at the school, YYYY-MM-DD. Passed in so the guard is testable. */
  today: string,
): Promise<void> {
  if (requestIds.length === 0) return;

  if (reminded) {
    await db
      .update(schema.requests)
      .set({
        remindedAt: new Date(),
        remindedBy: userId,
        reminderCount: sql`${schema.requests.reminderCount} + 1`,
      })
      .where(inArray(schema.requests.id, requestIds));
    return;
  }

  await db
    .update(schema.requests)
    .set({
      remindedAt: null,
      remindedBy: null,
      reminderCount: sql`greatest(0, ${schema.requests.reminderCount} - 1)`,
    })
    .where(
      and(
        inArray(schema.requests.id, requestIds),
        // Only ever undoes a chase made today. The date is compared in the
        // school's zone, not the server's — see lib/today.ts for the 5½-hour
        // window where those two disagree about which day it is.
        sql`(${schema.requests.remindedAt} at time zone 'Asia/Kolkata')::date = ${today}::date`,
      ),
    );
}
