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
  mobileTitle = size === "detail" ? "content" : "appbar",
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
  /** Index pages use the phone app bar; record/detail titles stay in content. */
  mobileTitle?: "appbar" | "content";
  /** Buttons that belong to the whole screen, not to a section within it. */
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1
          className={`${
            size === "page"
              ? "text-display font-semibold"
              : "text-[1.625rem] font-semibold leading-8 tracking-[-0.02em]"
          } ${mobileTitle === "appbar" ? "sr-only md:not-sr-only" : ""}`}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className={`${
              mobileTitle === "appbar" ? "mt-0 md:mt-1" : "mt-1"
            } text-[13px] text-[var(--color-ink-muted)]`}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        /*
         * NO `shrink-0` HERE, and that is the fix rather than the omission it
         * looks like: `shrink-0` and `flex-wrap` contradict each other. Held at
         * max-content the block never wrapped, so two ordinary buttons — "Back
         * to the board" and "Download by class" — pushed a 320px screen 16px
         * sideways instead of stacking. Letting it shrink is what lets its own
         * wrapping do the job.
         */
        <div className="flex min-w-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
