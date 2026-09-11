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
import { listPickableTeachers } from "@/lib/office";
import { sendMasterLink } from "@/lib/whatsapp-send";

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
  const rows = await listPickableTeachers();
  return rows.map((row) => ({ id: row.id, name: row.name }));
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
  /**
   * Why these children, when the group label alone would be a lie.
   *
   * Either the office's own typed sentence or one built from the gaps she
   * filtered on. It reaches the teacher's message and the top of her screen and
   * changes nothing about who is asked — see requests.reason_en.
   */
  reason?: { en: string; hi: string } | null;
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
      /**
       * The round's own link, and whether it reached the office.
       *
       * Null is ordinary: a subject round has no master link, and neither does
       * one created before anybody set an office number. `sent: false` with no
       * error is the same fact the rest of this app states plainly — the API
       * is off on this deployment, so use the card on the round's page.
       */
      master: { rosterSize: number; sent: boolean; error: string | null } | null;
    }
  | { ok: false; error: string };

export async function send(input: BulkRequest): Promise<SendResult> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot create requests." };
  }

  try {
    const result = await createBatch(toBatchInput(input, user.id));

    /*
     * The master link goes out on its own, without anybody pressing anything.
     *
     * That is the whole point of it: the office should not have to remember
     * that the round it just sent to nineteen teachers also has a link of its
     * own. It arrives on the office's phone at the same moment the teachers'
     * do, and is there at the end of the week when the last forty children are
     * what is left.
     *
     * AFTER THE LINKS AND NEVER INSTEAD OF THEM. Awaited rather than left
     * floating — a server action's process can be torn down the moment it
     * returns — but its outcome only decorates the result. A round whose
     * master link could not be sent is a round; the card on its page says so
     * and offers the button. Nothing here can fail the send that mattered.
     */
    const masterSent = result.master
      ? await sendMasterLink({ batchId: result.batchId, actor: user.id })
      : null;

    revalidatePath("/requests");
    revalidatePath("/");

    return {
      ok: true,
      batchId: result.batchId,
      created: result.created.length,
      failedAt: result.failed?.scope.value ?? null,
      failedMessage: result.failed?.message ?? null,
      remaining: result.remaining.length,
      master: result.master
        ? {
            rosterSize: result.master.rosterSize,
            sent: masterSent?.ok === true,
            error: masterSent && !masterSent.ok ? masterSent.error : null,
          }
        : null,
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
    reason: input.reason ?? null,
    // The per-child lines ride inside the audience, so a Resume days later
    // still has them for the groups it has yet to create.
    notes: input.audience.notes,
    createdBy,
  };
}

function message(error: unknown): string {
  if (error instanceof RequestValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not work that out.";
}
