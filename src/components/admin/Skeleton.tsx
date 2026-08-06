/**
 * Loading skeletons for the admin console.
 *
 * Every admin page is force-dynamic, so every navigation waits on the server.
 * Before this existed the browser showed the PREVIOUS page, frozen, until the
 * new one arrived — which is indistinguishable from a tap that did not
 * register, and is most of what "slow and old" actually means here.
 *
 * A skeleton, not a spinner. A spinner says "something is happening"; a
 * skeleton says "your table is coming and it will have these columns". So the
 * column headings below are the REAL headings, typed out, not grey bars — they
 * are known at build time and there is no reason to withhold them.
 *
 * These are server components. Nothing here is interactive and nothing here
 * should ship JavaScript.
 */

/** One grey bar. Width and height come from the caller as Tailwind classes. */
export function SkeletonBlock({ className = "h-4 w-24" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded bg-[var(--color-surface-muted)] ${className}`}
    />
  );
}

/**
 * Wraps a whole skeleton page.
 *
 * role="status" with a visually hidden label, because a screen reader user gets
 * nothing at all from a wall of grey rectangles.
 */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="space-y-6">
        {children}
      </div>
    </div>
  );
}

/** The h1 and its one-line subtitle, which every admin page has. */
export function SkeletonPageHeader({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2">
      <SkeletonBlock className={`h-8 ${wide ? "w-72" : "w-48"}`} />
      <SkeletonBlock className="h-4 w-64" />
    </div>
  );
}

/** Matches the dashboard's `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`. */
export function SkeletonStatGrid({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }, (_, index) => (
        <div
          key={index}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-5"
        >
          <SkeletonBlock className="h-9 w-16" />
          <SkeletonBlock className="mt-2 h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A bordered card with a heading and n lines. */
export function SkeletonCard({
  lines = 4,
  heading = true,
}: {
  lines?: number;
  heading?: boolean;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
      {heading ? <SkeletonBlock className="h-4 w-40" /> : null}
      <div className={heading ? "mt-4 space-y-3" : "space-y-3"}>
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="grid grid-cols-[9rem_1fr] gap-3">
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="h-4 w-full max-w-56" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The real headings, grey rows beneath them.
 *
 * Below `md` it becomes a stack of cards rather than a squeezed table, so the
 * skeleton and the thing it stands in for agree at every width.
 */
export function SkeletonTable({
  headers,
  rows = 8,
}: {
  headers: string[];
  rows?: number;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr
              key={row}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              {headers.map((header) => (
                <td key={header} className="px-4 py-3">
                  <SkeletonBlock className="h-4 w-full max-w-28" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-[var(--color-border)] md:hidden">
        {Array.from({ length: Math.min(rows, 6) }, (_, row) => (
          <li key={row} className="space-y-2 p-4">
            <SkeletonBlock className="h-5 w-40" />
            <SkeletonBlock className="h-4 w-28" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The search box and class filter above the students table. */
export function SkeletonFilterBar() {
  return (
    <div className="flex flex-wrap gap-2">
      <SkeletonBlock className="h-10 w-64 rounded-lg" />
      <SkeletonBlock className="h-10 w-40 rounded-lg" />
    </div>
  );
}
