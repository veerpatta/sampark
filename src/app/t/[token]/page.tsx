import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTeacherToken, type TeacherPageItem } from "@/lib/auth/token";
import { clientIp, limitByIp, limitByTeacherToken } from "@/lib/ratelimit";
import { describeAudienceLineHi } from "@/lib/whatsapp";

/**
 * Everything currently open for one teacher, on one durable link.
 *
 * A marks round used to mean the office handing over thirty-eight WhatsApp
 * messages. This is what makes the next round cost none: she keeps one URL,
 * and whatever the school is asking for appears on it.
 *
 * A MENU OF HER OWN WORK, AND NOTHING ELSE. No other teacher's requests, no
 * navigation past this list, nothing archived or closed. Authorization is
 * resolved in lib/auth/token.ts and nowhere else, and every entry here has been
 * through the same checkRequestAccess a /r/ link goes through.
 *
 * NO SERVICE WORKER, deliberately — see the note in public/sw.js. Caching this
 * page would leave every request token on the device after the link itself had
 * been revoked.
 *
 * Every rejection renders an identical 404: malformed, unknown, revoked, or a
 * teacher who has left. resolveTeacherToken returns null for all of them so
 * this page cannot tell them apart even by accident. "She has nothing open" is
 * NOT one of them — that is a real page with an empty list, because teaching
 * her that her saved link is broken would undo the whole point.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "आपकी सूचियाँ — Sampark",
  robots: { index: false, follow: false },
};

export default async function TeacherHomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rate limited BEFORE resolving, for the reason /api/r does it: a guess must
  // not cost a database read. A Server Component cannot answer 429 with a
  // Retry-After, so a refusal renders a Hindi "try again shortly" — honest for
  // the one real person who ever hits it, and no cheaper for anyone probing.
  const head = await headers();
  const [byToken, byIp] = await Promise.all([
    limitByTeacherToken(token),
    limitByIp(clientIp(head)),
  ]);
  if (!byToken.ok || !byIp.ok) return <TooBusy />;

  const page = await resolveTeacherToken(token);
  if (!page) notFound();

  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pb-8 pt-5">
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--color-brand-900)] px-4 py-3 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-lg font-semibold">{page.teacherName} जी</h1>
          <p className="mt-0.5 text-sm text-white/80">
            {page.items.length > 0
              ? `${page.items.length} सूची भरनी है`
              : "अभी कुछ बाकी नहीं"}
          </p>
        </div>
      </header>

      {page.items.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border)] px-4 py-8 text-center">
          <p className="font-medium">अभी कोई सूची बाकी नहीं है।</p>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            विद्यालय जब कुछ भेजेगा, वह यहीं दिखेगा — इस पेज को सहेज कर रखें।
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {page.items.map((item) => (
            <li key={item.token}>
              <RequestCard item={item} />
            </li>
          ))}
        </ol>
      )}

      <p className="mt-8 text-center text-xs text-[var(--color-ink-muted)]">
        यह पेज सिर्फ़ आपके लिए है। किसी और को न भेजें।
      </p>
    </main>
  );
}

/**
 * One open request.
 *
 * Same tab, not a new one: she is going one level down and coming back, and a
 * new tab per request turns her phone into a pile of them. The whole card is
 * the target — a 48px row beats six underlined words under a thumb.
 */
function RequestCard({ item }: { item: TeacherPageItem }) {
  const left = item.rosterSize - item.answered;
  const done = left === 0 && item.rosterSize > 0;
  const overdue = isOverdue(item.dueDate);

  return (
    <Link
      href={`/r/${item.token}`}
      className={`block rounded-[var(--radius-card)] border-2 p-4 transition-colors ${
        done
          ? "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)]"
          : overdue
            ? "border-[var(--color-partial-border)] bg-[var(--color-partial-bg)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <span className="block text-name font-medium">
        {describeAudienceLineHi({
          kind: item.audienceKind,
          label: item.audienceLabel,
          fieldKeys: item.fieldKeys,
        })}
      </span>
      <span className="mt-0.5 block text-sm text-[var(--color-ink-muted)]">
        {item.title}
      </span>

      <span className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono">
          {item.answered} / {item.rosterSize}
        </span>
        {done ? (
          <span className="font-medium text-[var(--color-confirm-fg)]">
            ✓ पूरा हो गया
          </span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">
            {left} बाकी
          </span>
        )}
      </span>

      <span
        className={`mt-1 block text-xs ${
          overdue
            ? "font-medium text-[var(--color-partial-fg)]"
            : "text-[var(--color-ink-muted)]"
        }`}
      >
        {overdue
          ? "अंतिम तिथि निकल चुकी है — अभी भी भर सकती हैं"
          : `${formatDue(item.dueDate)} तक`}
      </span>
    </Link>
  );
}

/**
 * Rate limited. Not a 404 — she is a real person holding a real link who tapped
 * twice, and telling her it does not exist would be false.
 */
function TooBusy() {
  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pt-16 text-center">
      <p className="font-medium">थोड़ी देर बाद कोशिश करें।</p>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        आपका लिंक ठीक है — बस एक मिनट रुक जाएँ।
      </p>
    </main>
  );
}

const DUE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

const formatDue = (date: string) => DUE_FMT.format(new Date(`${date}T12:00:00+05:30`));

/**
 * Past the due date but still inside the grace period — resolveTeacherToken
 * has already refused anything beyond it, so reaching here means she can still
 * answer and should be told so rather than shown a red flag.
 */
function isOverdue(dueDate: string): boolean {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  return dueDate < today;
}
