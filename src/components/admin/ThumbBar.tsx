/**
 * The admin's action bar, in the place a thumb can reach it — ABOVE the nav.
 *
 * Both are fixed to the bottom of a phone. AdminNav is z-40 and the two action
 * bars were z-20, so Approve, Reject and "Create 11 links" have been rendering
 * BEHIND it: the most consequential buttons in the console, on the surface the
 * office actually uses, unreachable. Tapping where Approve looked navigated you
 * to Students instead.
 *
 * Raising the bar's z-index would only move the problem — it would cover four
 * navigation targets to expose two actions. So it sits ON TOP of the nav,
 * offset by exactly the nav's height, which is why that height is a token that
 * AdminNav sets rather than a number typed into three files.
 *
 * At md and up the nav is back in the header and there is nothing to clear:
 * `desktop="sticky"` gives the review queue its toolbar at the top of the
 * scroll, `desktop="static"` lets the bulk send's button return to the flow.
 */
export function ThumbBar({
  children,
  desktop = "static",
}: {
  children: React.ReactNode;
  desktop?: "static" | "sticky";
}) {
  return (
    <div
      className={`fixed inset-x-0 bottom-[calc(var(--admin-nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[0_-4px_16px_rgb(15_23_42_/_0.08)] ${
        desktop === "sticky"
          ? "md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:rounded-[var(--radius-card)] md:border md:p-3 md:shadow-card"
          : "md:static md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none"
      }`}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        {children}
      </div>
    </div>
  );
}

/**
 * How much room a page with a ThumbBar has to leave under its content.
 *
 * The nav clearance is already on <main>; this is the bar on top of it. Stated
 * once so a page cannot leave three-quarters of it and bury its own last row.
 */
export const THUMB_BAR_CLEARANCE = "pb-24 md:pb-0";
