/**
 * Confirmation screen. The teacher should be able to close the phone here and
 * be certain the school has the data — "saved on phone" vs "sent to school" is
 * a distinction Phase 5 makes explicit.
 */
export default function TeacherDonePage() {
  return (
    <main className="teacher-surface mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl" aria-hidden>
        ✓
      </div>
      <h1 className="text-2xl font-semibold">धन्यवाद</h1>
      <p className="text-[var(--color-ink-muted)]">
        आपकी जानकारी विद्यालय को भेज दी गई है।
      </p>
      <p className="mt-6 font-mono text-xs uppercase tracking-wider text-[var(--color-pending)]">
        Phase 3 · not built yet
      </p>
    </main>
  );
}
