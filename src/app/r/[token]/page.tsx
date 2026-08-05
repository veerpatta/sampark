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

  return (
    <main className="teacher-surface mx-auto max-w-md px-4 pb-4 pt-5">
      <ServiceWorker />
      <header className="rounded-[var(--radius-card)] bg-[var(--color-brand-900)] px-4 py-4 text-white">
        <p className="text-sm opacity-80">
          कक्षा {request.classLabel} · {request.teacherName} जी
        </p>
        <h1 className="mt-0.5 text-xl font-semibold">{request.title}</h1>
        <p className="mt-2 text-sm opacity-80">
          अंतिम तिथि: {formatHindiDate(request.dueDate)}
          {request.period ? ` · ${request.period}` : ""}
        </p>
      </header>

      <p className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3 text-sm text-[var(--color-confirm-fg)]">
        हर नाम के आगे दी गई जानकारी देखें। सही हो तो{" "}
        <strong>सही है</strong> दबाएँ, गलत हो तो <strong>बदलें</strong> दबाकर
        ठीक करें। अंत में नीचे <strong>भेजें</strong> दबाना न भूलें।
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

function formatHindiDate(date: string): string {
  return new Intl.DateTimeFormat("hi-IN", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T00:00:00+05:30`));
}
