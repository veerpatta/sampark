import Link from "next/link";

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
      <h1 className="text-2xl font-semibold">धन्यवाद</h1>
      <p className="text-[var(--color-ink-muted)]">
        आपकी जानकारी विद्यालय को भेज दी गई है।
      </p>

      <Link
        href={`/r/${token}`}
        className="mt-4 flex w-full items-center justify-center rounded-lg border-2 border-[var(--color-border)] px-4 font-medium"
      >
        सूची फिर से देखें
      </Link>

      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        कुछ और बदलना हो तो ऊपर दबाकर वापस जा सकती हैं।
      </p>

      <p className="mt-8 text-xs text-[var(--color-ink-muted)]">
        श्री वीर पत्ता उ. मा. विद्यालय, आमेट
      </p>
    </main>
  );
}
