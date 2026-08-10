import { NextResponse } from "next/server";
import { resolveToken } from "@/lib/auth/token";
import {
  clientFingerprint,
  recordSubmissions,
  SubmissionValidationError,
  type StudentAnswer,
} from "@/lib/submissions";
import { clientIp, sweepRateLimits } from "@/lib/ratelimit";
import { guard } from "./guard";

/**
 * The teacher-facing API. The only endpoints reachable without an account.
 *
 * Both verbs resolve the token first and return an identical 404 for every
 * rejection — unknown, expired, closed. resolveToken returns null
 * for all of them so this file cannot tell them apart even by accident.
 *
 * Security headers for /api/r/* are set in next.config.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same body as the page render, for the offline client to refresh against. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limited = await guard(request, token);
  if (limited) return limited;

  // Roughly one request in fifty pays for the cleanup. No cron needed.
  if (Math.random() < 0.02) await sweepRateLimits();

  const resolved = await resolveToken(token);
  if (!resolved) return notFound();

  return NextResponse.json({
    request: {
      title: resolved.title,
      audienceLabel: resolved.audienceLabel,
      period: resolved.period,
      dueDate: resolved.dueDate,
      teacherName: resolved.teacherName,
    },
    fields: resolved.fields,
    roster: resolved.roster,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limited = await guard(request, token);
  if (limited) return limited;

  const resolved = await resolveToken(token);
  if (!resolved) return notFound();

  let body: { students?: unknown; idempotencyKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const answers = parseAnswers(body.students);
  if (!answers) {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }
  if (answers.length === 0) {
    return NextResponse.json({ error: "Nothing to submit." }, { status: 400 });
  }

  const fingerprint = clientFingerprint(
    clientIp(request.headers),
    request.headers.get("user-agent"),
  );

  // Generated on the phone, one per send. Replaying the same batch — the retry
  // after a dropped connection — writes nothing the second time.
  const idempotencyKey =
    typeof body.idempotencyKey === "string" &&
    /^[A-Za-z0-9_-]{8,64}$/.test(body.idempotencyKey)
      ? body.idempotencyKey
      : null;

  try {
    const result = await recordSubmissions(
      resolved,
      answers,
      fingerprint,
      idempotencyKey,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      // The client validates from the same registry module, so reaching here
      // means either a stale tab or someone bypassing the form. Return the
      // Hindi messages anyway — if it IS a real teacher, she needs to read it.
      return NextResponse.json(
        { error: "Some answers are not valid.", failures: error.failures },
        { status: 422 },
      );
    }
    throw error;
  }
}

/** Never render a body here — a 404 with content is a 404 that tells you things. */
function notFound() {
  return new NextResponse(null, { status: 404 });
}

function parseAnswers(raw: unknown): StudentAnswer[] | null {
  if (!Array.isArray(raw)) return null;

  const answers: StudentAnswer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.studentId !== "string") return null;

    const values: Record<string, string | null> = {};
    if (record.values && typeof record.values === "object") {
      for (const [key, value] of Object.entries(record.values)) {
        if (value === null) values[key] = null;
        else if (typeof value === "string") values[key] = value;
        else return null;
      }
    }

    answers.push({
      studentId: record.studentId,
      notPresent: record.notPresent === true,
      values,
    });
  }
  return answers;
}
