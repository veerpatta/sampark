import { NextResponse } from "next/server";
import {
  canCreateRequests,
  requireUser,
  UnauthorizedError,
} from "@/lib/auth/session";
import { createRequest, RequestValidationError } from "@/lib/requests";

/**
 * Create a request and freeze the roster snapshot.
 *
 * Everything the teacher will see is decided here, once, and written to
 * request_students. See lib/requests.ts for why it is never recomputed.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw error;
  }

  if (!canCreateRequests(user.role)) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const created = await createRequest({
      title: String(body.title ?? ""),
      classLabel: String(body.classLabel ?? ""),
      teacherId: String(body.teacherId ?? ""),
      fieldKeys: Array.isArray(body.fieldKeys) ? body.fieldKeys.map(String) : [],
      period: body.period ? String(body.period) : null,
      dueDate: String(body.dueDate ?? ""),
      contactPhone: body.contactPhone ? String(body.contactPhone) : null,
      createdBy: user.id,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
