import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
// The /ssr entry, because this page is a Server Component: the default export
// is a client component and would pull React into the bundle for one tick.
// Same reasoning as components/admin/SettingsList.tsx.
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { resolveTeacherToken, type TeacherPageItem } from "@/lib/auth/token";
import { isAnsweredFully } from "@/lib/answered";
import { clientIp, limitByIp, limitByTeacherToken } from "@/lib/ratelimit";
import { describeAudienceLine } from "@/lib/whatsapp";
import { Bi } from "@/components/teacher/Bi";
import { T } from "@/components/teacher/strings";

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
  title: "Your lists — Sampark",
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
  // Retry-After, so a refusal renders a plain "try again shortly" — honest for
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
          <h1 className="text-lg font-semibold">{page.teacherName}</h1>
          <p className="mt-0.5 text-sm text-white/80">
            <Bi
              t={
                page.items.length > 0
                  ? T.listsToFill(page.items.length)
                  : T.nothingPending
              }
            />
          </p>
        </div>
      </header>

      {page.items.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border)] px-4 py-8 text-center">
          <p className="font-medium">
            <Bi t={T.noListsYet} />
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            <Bi t={T.noListsNote} />
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
        <Bi t={T.pageIsYours} />
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
  // The office's own predicate, imported rather than restated. This used to be
  // written out here over an `answered` that counted differently, so the two
  // screens could call the same list finished and unfinished at once.
  const done = isAnsweredFully({
    rosterSize: item.rosterSize,
    studentsAnswered: item.answered,
  });
  const left = Math.max(0, item.rosterSize - item.answered);
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
        {describeAudienceLine({
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
        {/* Bilingual, like everything else she is told rather than reads off to
            identify a child — strings.ts states that rule and these three lines
            were the only place on her surface not keeping it. The Hindi was
            already written for all of them.

            The tick is a Phosphor icon and not a literal ✓ (U+2713): that is an
            ordinary character, so what she saw was whichever glyph her phone's
            fallback font happened to carry, at whatever weight and baseline it
            drew it. design-qa.md has ruled against exactly this twice. */}
        {done ? (
          /* Bi's Hindi half is a `block` span, so it has to sit inside a plain
             child rather than directly in this flex row — as a flex item it
             would line up BESIDE the English instead of under it. */
          <span className="flex items-start gap-1 font-medium text-[var(--color-confirm-fg)]">
            <CheckCircle
              aria-hidden
              size={16}
              weight="fill"
              className="mt-0.5 shrink-0"
            />
            <span>
              <Bi t={T.listDone} />
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">
            <Bi t={T.listLeft(left)} />
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
        <Bi t={overdue ? T.overdue : T.dueBy(formatDue(item.dueDate))} />
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
      <p className="font-medium">
        <Bi t={T.tooBusy} />
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.tooBusyNote} />
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
