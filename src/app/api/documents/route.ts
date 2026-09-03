import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  canApproveIntoMaster,
  currentUser,
  requireUser,
  UnauthorizedError,
} from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { isDocumentKind, isDocumentPathname } from "@/lib/documents";
import { addDocument, findLiveDocument, removeDocument } from "@/lib/document-store";

/**
 * The office's way of reading, attaching and removing a child's documents.
 *
 * A PROXY, NOT A SIGNED URL, for the reason /api/photos gives: a presigned URL
 * is a bearer credential that lands in browser history and screenshots, and
 * these are scans of Aadhaar cards. Every read re-checks the session.
 *
 * The same 404-for-everything on GET as the photo proxy — missing session,
 * junk pathname, removed document, absent blob all read alike — and honest
 * status codes on POST and DELETE, where a member of staff has already been
 * authenticated and "too large" is worth more to her than an attacker learns.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return notFound();

  const pathname = new URL(request.url).searchParams.get("p");
  if (!isDocumentPathname(pathname)) return notFound();

  // The row, not just the blob: a removed document's bytes may linger for a
  // moment after the row is stamped, and the row is what says it is gone.
  const row = await findLiveDocument(pathname);
  if (!row) return notFound();

  const blob = await get(pathname, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return notFound();

  const ext = pathname.slice(pathname.lastIndexOf(".") + 1);
  return new Response(blob.stream, {
    headers: {
      "content-type": row.contentType,
      "content-disposition": `inline; filename="${row.kind}-${row.studentId}.${ext}"`,
      "x-content-type-options": "nosniff",
      // A year, immutable: the pathname is minted once and never overwritten.
      "cache-control": "private, max-age=31536000, immutable",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function notFound() {
  return new NextResponse(null, { status: 404 });
}

/** 401 or 403 as JSON, or the user. The same split the photo and import routes use. */
async function editor(): Promise<
  { user: { id: string } } | { response: NextResponse }
> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
    }
    throw error;
  }
  if (!canApproveIntoMaster(user.role)) {
    return {
      response: NextResponse.json(
        { error: "Your role can view a document but not attach or remove one." },
        { status: 403 },
      ),
    };
  }
  return { user };
}

export async function POST(request: Request) {
  const gate = await editor();
  if ("response" in gate) return gate.response;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a form." }, { status: 400 });

  const studentId = form.get("studentId");
  const kind = form.get("kind");
  const label = form.get("label");
  const file = form.get("file");
  if (typeof studentId !== "string" || !(file instanceof File) || !isDocumentKind(kind)) {
    return NextResponse.json({ error: "Expected a student, a kind and a file." }, { status: 400 });
  }

  const [student] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);
  if (!student) return NextResponse.json({ error: "No such student." }, { status: 404 });

  const result = await addDocument({
    studentId,
    kind,
    label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : null,
    bytes: new Uint8Array(await file.arrayBuffer()),
    uploadedBy: gate.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath(`/students/${studentId}`);
  return NextResponse.json({ id: result.id, pathname: result.pathname }, { status: 201 });
}

export async function DELETE(request: Request) {
  const gate = await editor();
  if ("response" in gate) return gate.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Expected a document id." }, { status: 400 });
  }

  const outcome = await removeDocument(id, gate.user.id);
  if (!outcome.removed) {
    return NextResponse.json({ error: "No such document, or already removed." }, { status: 404 });
  }

  if (outcome.studentId) revalidatePath(`/students/${outcome.studentId}`);
  return NextResponse.json({ removed: true });
}
