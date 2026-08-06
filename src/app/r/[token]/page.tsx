import { notFound } from "next/navigation";
import { resolveToken } from "@/lib/auth/token";
import { RequestForm } from "@/components/teacher/RequestForm";
import { ServiceWorker } from "@/components/teacher/ServiceWorker";

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
  const asking = request.fields.map((field) => field.labelHi).join(" · ");

  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pb-4 pt-5">
      <ServiceWorker />
      {/* Sticky, and deliberately short: the class and the ask stay on screen
          the whole way down a 46-card list. */}
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--color-brand-900)] px-4 py-3 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-lg font-semibold">{request.classLabel}</h1>
            <p className="shrink-0 text-xs opacity-80">
              {formatHindiDate(request.dueDate)} तक
            </p>
          </div>
          <p className="mt-0.5 truncate text-sm opacity-90">
            {asking}
            {request.period ? ` · ${request.period}` : ""}
          </p>
        </div>
      </header>

      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
        {request.teacherName} जी — {request.title}
      </p>

      <p className="mt-3 rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
        जिन बच्चों की जानकारी नहीं है, वे सबसे ऊपर हैं — पहले वही भरें। बाकी
        सबकी जानकारी पहले से है; ठीक हो तो एक बार में{" "}
        <strong>सब सही हैं</strong> दबा दें। अंत में नीचे <strong>भेजें</strong>{" "}
        दबाना न भूलें।
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
 * Hindi month, Latin day.
 *
 * hi-IN already defaults to Latin numerals — checked on the deployed Node —
 * but that is a CLDR default, not a promise, and it is the due date. Pinning
 * the numbering system means the one date on this screen cannot quietly become
 * ११ अगस्त because an ICU table moved.
 */
function formatHindiDate(date: string): string {
  return new Intl.DateTimeFormat("hi-IN-u-nu-latn", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T00:00:00+05:30`));
}
