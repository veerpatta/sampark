/**
 * The heading block every console screen opens with.
 *
 * Fifteen screens were each writing their own
 * `<header><h1 className="text-display font-semibold tracking-tight">`, which
 * is fine until the sixteenth forgets the tracking, or a design decision moves
 * and has to be applied fifteen times. Tracking now comes from the type token
 * itself; what is left here is the structure — a title, and one muted line
 * under it saying how much of a thing there is.
 *
 * THE SUBTITLE IS NOT DECORATION. "531 records, active only", "14 requests",
 * "2 of 6 open requests past due" — the count and its qualifier are the first
 * thing the office wants and the thing they would otherwise have to scroll to
 * infer. A screen with nothing true to say there should pass nothing.
 */
export function PageHeader({
  title,
  subtitle,
  size = "page",
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /**
   * `detail` is a notch smaller, for a screen about one thing that already
   * names itself — a single request, one student. The title on those is data,
   * often long, and at full display size a two-line student name pushes the
   * record itself off the first screen of a phone.
   */
  size?: "page" | "detail";
  /** Buttons that belong to the whole screen, not to a section within it. */
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1
          className={
            size === "page"
              ? "text-display font-semibold"
              : "text-[1.625rem] font-semibold leading-8 tracking-[-0.02em]"
          }
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
