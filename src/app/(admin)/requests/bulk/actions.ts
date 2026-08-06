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
  /** Who could be picked, when the problem is "two owners". */
  candidates: { id: string; name: string }[];
};

export type PreviewResult =
  | {
      ok: true;
      groups: PreviewGroup[];
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
    createdBy,
  };
}

function message(error: unknown): string {
  if (error instanceof RequestValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not work that out.";
}
