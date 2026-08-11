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
 *
 * The ground is translucent and blurred rather than solid white, and it lifts
 * the page with --shadow-rail. Both say the same thing: there is more content
 * underneath this, you have not reached the end. A flat opaque strip reads as
 * the bottom of the document, which is exactly wrong on a review queue of
 * ninety rows. The teacher surface's rail already worked this way; the console
 * was using a shallower shadow of its own, so the same phone lifted its two
 * bottom bars by different amounts.
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
      className={`fixed inset-x-0 bottom-[calc(var(--admin-nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)]/96 px-4 py-3 shadow-[var(--shadow-rail)] backdrop-blur-sm ${
        desktop === "sticky"
          ? "md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:rounded-[var(--radius-card)] md:border md:bg-[var(--color-surface)] md:p-3 md:shadow-card md:backdrop-blur-none"
          : "md:static md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none"
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
