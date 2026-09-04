import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { clientIp, limitByIp } from "@/lib/ratelimit";
import { TEST_SUFFIX } from "@/lib/whatsapp-templates";
import { Bi } from "@/components/teacher/Bi";
import { T } from "@/components/teacher/strings";

/**
 * Where the button on a WhatsApp template message lands.
 *
 * A template's URL button is approved with its base URL baked in, and the
 * app may only append one value at send time. Whether a "/" inside that value
 * survives Meta and AiSensy is a question that costs six re-approvals to get
 * wrong, so the value is a bare token and THIS route works out what it names:
 * a request (`/r/`) or a teacher's durable page (`/t/`). It redirects and does
 * nothing else.
 *
 * NO AUTHORIZATION HAPPENS HERE, and none may be added. The two pages it sends
 * a teacher to resolve their own token through lib/auth/token.ts, exactly as
 * they do when she taps a link the office pasted by hand — a closed request or
 * a revoked page still renders their 404 there. This route only has to be
 * unable to say anything they would not: an unknown token 404s here the same
 * way, and a known one reveals nothing beyond a redirect she was sent on
 * purpose.
 *
 * Rate limited by IP before either lookup, like /t/, so a guess costs no
 * database read.
 *
 * `/w/test` is the one value that goes nowhere: the test send on
 * Settings → WhatsApp carries it, so the office can prove the button works
 * before any teacher receives a real one.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sampark",
  robots: { index: false, follow: false },
};

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (token === TEST_SUFFIX) return <TestLanding />;

  // Same shape rule the resolvers apply, so a malformed value is refused
  // before the rate limit is even spent.
  if (!/^[A-Za-z0-9_-]{16}$/.test(token)) notFound();

  const head = await headers();
  const byIp = await limitByIp(clientIp(head));
  if (!byIp.ok) return <TooBusy />;

  const [request] = await db
    .select({ token: schema.requests.token })
    .from(schema.requests)
    .where(eq(schema.requests.token, token))
    .limit(1);
  if (request) redirect(`/r/${request.token}`);

  const [teacher] = await db
    .select({ token: schema.teachers.linkToken })
    .from(schema.teachers)
    .where(eq(schema.teachers.linkToken, token))
    .limit(1);
  if (teacher?.token) redirect(`/t/${teacher.token}`);

  notFound();
}

function TestLanding() {
  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pt-16 text-center">
      <p className="font-medium">
        <Bi
          t={{
            en: "This is a test message from Sampark. The button works.",
            hi: "यह Sampark का परीक्षण संदेश है। बटन काम कर रहा है।",
          }}
        />
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        <Bi
          t={{
            en: "Nothing to fill in. A real message opens your list here.",
            hi: "यहाँ कुछ भरना नहीं है। असली संदेश से आपकी सूची यहीं खुलेगी।",
          }}
        />
      </p>
    </main>
  );
}

function TooBusy() {
  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pt-16 text-center">
      <p className="font-medium">
        <Bi t={T.tooBusy} />
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.tooBusyNote} />
      </p>
    </main>
  );
}
