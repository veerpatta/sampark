import Link from "next/link";
import { Bi } from "@/components/teacher/Bi";
import { T } from "@/components/teacher/strings";

/**
 * Confirmation screen.
 *
 * The teacher should be able to put the phone down here and be certain the
 * school has the data. The link back matters: re-submission is allowed until
 * the office closes the request, and a teacher who remembers one more
 * correction should not have to go hunting through WhatsApp for the link again.
 *
 * Phase 5 makes "saved on phone" and "sent to school" visibly different states.
 */
export default async function TeacherDonePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="teacher-surface mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-confirm-bg)] text-4xl text-[var(--color-confirm-fg)]"
        aria-hidden
      >
        ✓
      </div>
      <h1 className="text-2xl font-semibold">
        <Bi t={T.thankYou} />
      </h1>
      <p className="text-[var(--color-ink-muted)]">
        <Bi t={T.sentToSchool} />
      </p>

      <Link
        href={`/r/${token}`}
        className="mt-4 flex w-full flex-col items-center justify-center rounded-lg border-2 border-[var(--color-border)] px-4 py-2 font-medium"
      >
        <Bi t={T.seeListAgain} />
      </Link>

      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        <Bi t={T.changeMore} />
      </p>

      <p className="mt-8 text-xs text-[var(--color-ink-muted)]">
        <Bi t={T.schoolName} />
      </p>
    </main>
  );
}
