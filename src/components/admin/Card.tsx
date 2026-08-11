import { card, eyebrow, stepBadge } from "@/components/ui/controls";

/**
 * A card: one border, one soft shadow, and a quiet uppercase label naming what
 * is inside it.
 *
 * The console is a long single column on a phone and a wide one on a laptop,
 * and in both cases the reader's real question is "how many separate things am
 * I looking at". A card answers that and nothing else — it carries no state,
 * no tone, no emphasis. Everything that varies is inside it.
 *
 * `flush` exists for the cards whose content is a list that should run edge to
 * edge (the review queue, change history, the settings index). Those pad their
 * own rows, and a card padding them again puts a 16px gutter outside a divider
 * that is supposed to reach both sides.
 */
export function Card({
  title,
  step,
  action,
  flush = false,
  children,
  className = "",
}: {
  /** The eyebrow. Rendered as an h2 — quiet in appearance, not in outline. */
  title?: React.ReactNode;
  /**
   * A numeral before the title, for steps that genuinely must happen in order.
   * Numbering cards that do not depend on each other tells the reader there is
   * a sequence to obey when there is not.
   *
   * A string is allowed for the one card that ends a sequence rather than
   * continuing it — the import wizard's result card marks itself with a tick,
   * because "4" would imply there is a fifth thing left to do.
   */
  step?: number | string;
  /** One link or button belonging to this card, set against the title. */
  action?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`${card()} ${flush ? "overflow-hidden" : "p-4 md:p-6"} ${className}`}
    >
      {title ? (
        <div
          className={`flex items-baseline justify-between gap-3 ${
            flush ? "border-b border-[var(--color-border)] px-4 py-3" : ""
          }`}
        >
          <h2 className={`flex items-center gap-2 ${eyebrow()}`}>
            {step !== undefined ? (
              <span aria-hidden className={stepBadge()}>
                {step}
              </span>
            ) : null}
            {title}
          </h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {title && !flush ? <div className="mt-3">{children}</div> : children}
    </section>
  );
}
