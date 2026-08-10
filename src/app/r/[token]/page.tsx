import { notFound } from "next/navigation";
import { resolveToken } from "@/lib/auth/token";
import { RequestForm } from "@/components/teacher/RequestForm";
import { ServiceWorker } from "@/components/teacher/ServiceWorker";
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

  // What is being asked, in the fewest words that still say it.
  const asking = request.fields.map((field) => field.labelEn).join(" · ");

  /*
   * WHICH REGISTERS THIS LINK COVERS.
   *
   * A class link says "Class 8" and needs nothing more. A SUBJECT link merges
   * every class a teacher takes that subject for, so Chemistry opened as
   * eighty-four children with nothing anywhere naming the three registers they
   * came from. Named here, and repeated on each row — see Recognition.
   */
  const spans = request.classLabels.length > 1;

  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pb-0">
      <ServiceWorker />
      {/*
        TWO LINES, NOT FOUR. This bar and the rail at the bottom were taking
        roughly a third of a 667px phone between them, which is a third of the
        list she is trying to work through — so the ask is one line and the
        Hindi second line is gone from here. It has not been dropped: every
        field label on every card below carries its Hindi already, which is
        where she reads it while answering rather than at the top while
        scrolling past.
      */}
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--color-brand-900)] px-5 pb-2.5 pt-2.5 text-white shadow-[0_1px_0_rgba(255,255,255,0.12)]">
        <div className="mx-auto max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">
              {request.audienceLabel}
            </h1>
            <p className="shrink-0 text-xs opacity-90">
              {T.dueBy(formatDueDate(request.dueDate)).en}
            </p>
          </div>
          <p className="mt-0.5 truncate text-xs opacity-90">
            {spans ? `${request.classLabels.join(" · ")} — ` : ""}
            {asking}
            {request.period ? ` · ${request.period}` : ""}
          </p>
        </div>
      </header>

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
