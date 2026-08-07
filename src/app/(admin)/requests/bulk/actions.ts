"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import {
  createBatch,
  previewBatch,
  scopeKey,
  type BatchInput,
} from "@/lib/batches";
import { RequestValidationError } from "@/lib/requests";
import type { Audience } from "@/lib/students";
import type { RecipientMode } from "@/lib/fanout";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Everyone the office could name for a group nobody is down for.
 *
 * The whole list, not the owners: chooseTeacherForScope's own contract says
 * "Nobody owns it. Nothing is selected and the full list is offered", and the
 * preview screen had only ever implemented the first half — so a group with no
 * owner showed the problem and no way to answer it. Classes get covered by
 * whoever is available, and so do subjects.
 */
async function pickableTeachers() {
  return db
    .select({ id: schema.teachers.id, name: schema.teachers.name })
    .from(schema.teachers)
    .where(eq(schema.teachers.active, true))
    .orderBy(asc(schema.teachers.name));
}

/**
 * The bulk send.
 *
 * Server actions rather than a route handler: `revalidatePath` comes free, and
 * both calls return a structured plan that a fetch would only have to re-shape.
 * Same shape as /review's decide().
 *
 * `office` can create requests but cannot approve — canCreateRequests, not
 * canApproveIntoMaster. Sending a link asks a question; it changes no master
 * data, and every answer still goes through the review queue.
 */

export type BulkRequest = {
  title: string;
  audience: Audience;
  fieldKeys: string[];
  period?: string | null;
  dueDate: string;
  recipientMode: RecipientMode;
  overrides?: Record<string, { teacherId?: string; contactPhone?: string }>;
  skip?: string[];
  /** Save the teachers she named, so next round already knows them. */
  remember?: boolean;
};

export type PreviewGroup = {
  key: string;
  kind: string;
  label: string;
  students: number;
  teacherId: string | null;
  teacherName: string | null;
  /** Set when this group cannot be sent as it stands. */
  problem: string | null;
  /**
   * Who is already down for this group. Empty when the problem is that NOBODY
   * is — which is exactly the case the office most needs to fix, so the picker
   * falls back to `teachers` below rather than disappearing.
   */
  candidates: { id: string; name: string }[];
  /** True when naming someone here would fill a real gap in the records. */
  fillsAGap: boolean;
};

export type PreviewResult =
  | {
      ok: true;
      groups: PreviewGroup[];
      /** Everyone who could be picked, for a group nobody is down for. */
      teachers: { id: string; name: string }[];
      links: number;
      students: number;
      audienceSize: number;
      unassigned: { count: number; reason: string; sample: string[] } | null;
    }
  | { ok: false; error: string };

export async function preview(input: BulkRequest): Promise<PreviewResult> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot create requests." };
  }

  try {
    const { plan, audienceSize } = await previewBatch(
      toBatchInput(input, user.id),
    );

    const groups: PreviewGroup[] = [
      ...plan.ready.map((group) => ({
        key: scopeKey(group.scope),
        kind: group.scope.kind,
        label: group.scope.value,
        students: group.studentIds.length,
        teacherId: group.teacherId,
        teacherName: group.teacherName,
        problem: null,
        candidates: [],
        fillsAGap: false,
      })),
      ...plan.blocked.map((group) => ({
        key: scopeKey(group.scope),
        kind: group.scope.kind,
        label: group.scope.value,
        students: group.studentIds.length,
        teacherId: null,
        teacherName: null,
        problem: group.message,
        candidates: group.choice.owners.map((owner) => ({
          id: owner.id,
          name: owner.name,
        })),
        // "Nobody is down for this" is a hole in the records; naming someone
        // answers it for good. "Two are down" is a choice about this round.
        fillsAGap: group.reason === "no-owner",
      })),
    ];

    // Stated in words, and never as the gap between two totals. Children with
    // no house on record are the ones whose data is thinnest, and a send that
    // quietly skips them looks exactly like a send that covered everyone.
    const unassigned =
      plan.unassigned.length > 0
        ? {
            count: plan.unassigned.length,
            reason: plan.unassigned[0]!.reason,
            sample: plan.unassigned.slice(0, 5).map((row) => row.name),
          }
        : null;

    return {
      ok: true,
      groups,
      teachers: await pickableTeachers(),
      links: plan.totals.links,
      students: plan.totals.students,
      audienceSize,
      unassigned,
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export type SendResult =
  | {
      ok: true;
      batchId: string;
      created: number;
      failedAt: string | null;
      failedMessage: string | null;
      remaining: number;
    }
  | { ok: false; error: string };

export async function send(input: BulkRequest): Promise<SendResult> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot create requests." };
  }

  try {
    const result = await createBatch(toBatchInput(input, user.id));

    revalidatePath("/requests");
    revalidatePath("/");

    return {
      ok: true,
      batchId: result.batchId,
      created: result.created.length,
      failedAt: result.failed?.scope.value ?? null,
      failedMessage: result.failed?.message ?? null,
      remaining: result.remaining.length,
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

function toBatchInput(input: BulkRequest, createdBy: string): BatchInput {
  return {
    title: input.title,
    audience: input.audience,
    fieldKeys: input.fieldKeys,
    period: input.period ?? null,
    dueDate: input.dueDate,
    recipientMode: input.recipientMode,
    overrides: input.overrides,
    skip: input.skip,
    remember: input.remember,
    createdBy,
  };
}

function message(error: unknown): string {
  if (error instanceof RequestValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not work that out.";
}
