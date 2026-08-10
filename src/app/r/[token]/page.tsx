import { notFound } from "next/navigation";
import { resolveToken } from "@/lib/auth/token";
import { RequestForm } from "@/components/teacher/RequestForm";
import { ServiceWorker } from "@/components/teacher/ServiceWorker";
import { Bi } from "@/components/teacher/Bi";
import { T } from "@/components/teacher/strings";

/**
 * The only page a teacher ever sees.
 *
 * No admin shell, no navigation, no menu — a link opens exactly one class and
 * exactly the fields requested. Authorization is resolved in
 * `src/lib/auth/token.ts` and nowhere else.
 *
 * Every rejection (unknown token, expired, closed) renders an
 * identical 404. resolveToken returns null for all of them so this page cannot
 * accidentally tell them apart.
 */
export const dynamic = "force-dynamic";

export default async function TeacherRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const request = await resolveToken(token);
  if (!request) notFound();

  // What is being asked, in the fewest words that still say it. Scrolling 46
  // cards should never leave her wondering which class she is in or why.
  const asking = request.fields.map((field) => field.labelEn).join(" · ");
  const askingHi = request.fields.map((field) => field.labelHi).join(" · ");

  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pb-4 pt-5">
      <ServiceWorker />
      {/* Sticky, and deliberately short: the class and the ask stay on screen
          the whole way down a 46-card list. */}
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--color-brand-900)] px-4 py-3 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-lg font-semibold">{request.audienceLabel}</h1>
            <p className="shrink-0 text-xs opacity-80">
              {T.dueBy(formatDueDate(request.dueDate)).en}
            </p>
          </div>
          <p className="mt-0.5 truncate text-sm opacity-90">
            {asking}
            {request.period ? ` · ${request.period}` : ""}
          </p>
          <p lang="hi" className="truncate text-xs opacity-70">
            {askingHi}
          </p>
        </div>
      </header>

      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
        {request.teacherName} — {request.title}
      </p>

      {/* Says what actually happens now. The old copy promised a review screen
          before anything left the phone, and that promise is no longer kept —
          answers go by themselves. Saying so plainly is the trade: she is told
          she can still fix anything, and the office review queue is unchanged
          behind it, so nothing reaches a student record unapproved either way. */}
      <p className="mt-3 rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
        <Bi t={T.intro} />
      </p>

      <RequestForm
        token={token}
        fields={request.fields.map((field) => ({
          key: field.key,
          labelEn: field.labelEn,
          labelHi: field.labelHi,
          mode: field.mode,
          inputType: field.inputType,
          exactLen: field.exactLen,
          pattern: field.pattern,
          maxValue: field.maxValue,
          options: field.options,
          targetColumn: field.targetColumn,
        }))}
        roster={request.roster}
      />
    </main>
  );
}

/**
 * The due date, in English, in Latin digits.
 *
 * It used to be a Hindi month name with the numbering system pinned to Latin,
 * because hi-IN's Latin default is a CLDR convention rather than a promise and
 * ११ अगस्त on a due date is unreadable. The screen is English-primary now, so
 * en-IN is the honest locale — and it has the same Latin digits by definition
 * rather than by pinning.
 */
function formatDueDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T00:00:00+05:30`));
}
