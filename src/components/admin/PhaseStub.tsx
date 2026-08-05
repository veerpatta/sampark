/**
 * Honest placeholder for a route that exists in the plan but is not built yet.
 * Every stub names the phase that will fill it, so nobody mistakes an empty
 * screen for a broken one.
 */
export function PhaseStub({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8">
      <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-pending)]">
        {phase}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {children}
      </div>
    </section>
  );
}
