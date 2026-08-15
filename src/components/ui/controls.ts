/**
 * The control vocabulary.
 *
 * WHY CLASS STRINGS AND NOT COMPONENTS. Four of the things this app styles as
 * buttons are not buttons: the Remind action on the dashboard is an
 * `<a target="_blank">` because a real link is never popup-blocked, the camera
 * and gallery actions in PhotoField are `<label>`s wrapping a `sr-only` file
 * input, half the console's "buttons" are `<Link>`s, and FilterBar's chips are
 * `<label>`s over `peer sr-only` checkboxes inside a GET form so the students
 * board still filters with JavaScript switched off. A <Button> component would
 * have to grow an `as` prop to serve any of them and would quietly break the
 * last one. A function that returns a class string serves all five and adds no
 * runtime.
 *
 * The shapes below are the whole set. If a screen needs a sixth, that is a
 * design decision worth making here rather than an arbitrary class string
 * somewhere in a 700-line page — which is exactly how 118 separate
 * `rounded-lg border …` strings and two competing chip idioms got here.
 */

/**
 * What the control is for, which decides its size and radius.
 *
 *  - `action` — the ordinary 48px control. Toolbar buttons, row actions,
 *    secondary choices. --tap-min, because the office works this one-handed.
 *  - `commit` — the full-width button that does the thing and cannot be
 *    undone by tapping again: create the request, apply 108 changes, send.
 *    Taller and rounder on purpose, so a thumb travelling down the page knows
 *    it has arrived at the end of the screen without reading.
 */
type Shape = "action" | "commit";

/**
 *  - `primary` — brand blue. The one forward move on the screen.
 *  - `go`      — green. Reserved for sends that leave the app: WhatsApp, and
 *    approving into the master record. Distinct from primary because "this
 *    navigates you somewhere else and a teacher will see it" is worth its own
 *    colour.
 *  - `quiet`   — bordered on white. Everything else.
 *  - `danger`  — bordered on white with red text, never a red fill. A filled
 *    red button reads as the primary action of the screen, which reject and
 *    revoke are not.
 */
type Tone = "primary" | "go" | "quiet" | "danger";

const SHAPE: Record<Shape, string> = {
  action:
    "min-h-[var(--tap-min)] rounded-[var(--radius-control)] px-4 text-sm font-semibold",
  commit:
    "min-h-[52px] rounded-[var(--radius-commit)] px-5 text-[15px] font-semibold",
};

/**
 * The keyboard's half of the press feedback.
 *
 * `active:scale` below is the only acknowledgement a TAP gets, and it is the
 * only one these controls had. A pointer gets `hover`; a keyboard got a 1px
 * border colour change on `field()` and nothing at all on `btn()` or `chip()` —
 * which is colour as the sole carrier of state, the one thing this design
 * language forbids everywhere else.
 *
 * `focus-visible` and not `focus`, so a thumb on the teacher surface does not
 * leave a ring sitting behind it on a control she has already finished with.
 *
 * `outline-solid` RATHER THAN `outline`, AND THAT IS NOT A STYLE CHOICE.
 * Tailwind v4 compiles a width utility to `outline-style: var(--tw-outline-style)`,
 * and `outline-none` — which `field()` below sets, to kill the browser's own
 * ring — compiles to `--tw-outline-style: none`. So a plain `outline-2` on an
 * input resolves its style through a variable that input has already set to
 * `none`, and the ring is invisible on precisely the controls that most need
 * one. `outline-solid` sets the variable back, and wins on specificity because
 * it carries the `:focus-visible` pseudo-class and `.outline-none` does not.
 */
const FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-600)]";

const TONE: Record<Tone, string> = {
  primary: "border border-transparent bg-[var(--color-brand-600)] text-white",
  go: "border border-transparent bg-[var(--color-success)] text-white",
  quiet:
    "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]",
  danger:
    "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]",
};

/**
 * A button, or a thing behaving as one.
 *
 * The press feedback is part of the vocabulary rather than an option: a phone
 * gives no hover, so `active:scale-[0.98]` is the only acknowledgement a tap
 * gets before the screen changes. It is already the idiom in QuickSend and
 * StudentRow; this makes it the rule. The global prefers-reduced-motion block
 * in globals.css neutralises it for anyone who has asked.
 */
export function btn(
  options: { shape?: Shape; tone?: Tone; full?: boolean } = {},
): string {
  const { shape = "action", tone = "quiet", full = false } = options;
  return [
    "inline-flex items-center justify-center gap-2",
    SHAPE[shape],
    TONE[tone],
    "transition-transform active:scale-[0.98]",
    FOCUS,
    "disabled:pointer-events-none disabled:opacity-40",
    full ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A chip: a choice among several, where the choices are the content.
 *
 * Two shapes, and they are not interchangeable. The default is a *selection*
 * chip — pick a class, pick a field, pick which houses a teacher owns — and it
 * is 44px because picking is the work of that screen. `pill` is a *filter*
 * chip, which narrows a list you are already looking at, and is smaller
 * because it is chrome around the real content.
 *
 * `on` is the selected state. It is a border and a tint, never a fill: these
 * appear in rows of six or eight, and six filled blue rectangles read as six
 * primary buttons.
 */
export function chip(
  options: { on?: boolean; pill?: boolean } = {},
): string {
  const { on = false, pill = false } = options;
  return [
    "inline-flex items-center justify-center gap-2 border font-medium",
    pill
      ? "min-h-9 rounded-[var(--radius-chip)] px-3 text-sm"
      : "min-h-[44px] rounded-[var(--radius-control)] px-4 text-sm",
    on
      ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]",
    "transition-transform active:scale-[0.98]",
    FOCUS,
  ].join(" ");
}

/**
 * A text input, select or the box that looks like one.
 *
 * 48px rather than the teacher surface's 56px — the console is denser and has
 * a pointer at md and up. The 16px minimum font-size that stops iOS zooming on
 * focus is not here: it is one rule in tokens.css hung off `.admin-surface`,
 * where it can explain itself once instead of forty times.
 */
export function field(options: { invalid?: boolean } = {}): string {
  return [
    "w-full min-h-[var(--tap-min)] rounded-[var(--radius-control)] border bg-[var(--color-surface)] px-3 text-sm outline-none",
    options.invalid
      ? "border-[var(--color-danger)]"
      : "border-[var(--color-border)] focus:border-[var(--color-brand-600)]",
    // The border change STAYS and the ring is added on top. On a box the border
    // is a real signal — it is the edge of the thing you are typing in — but a
    // 1px colour swap on its own is invisible on a cheap screen in daylight,
    // and it is nothing at all to anyone who cannot separate the two colours.
    FOCUS,
    "placeholder:text-[var(--color-ink-faint)]",
  ].join(" ");
}

/**
 * The small uppercase label over a section — "SEND A LINK", "WHAT WAS FROZEN".
 *
 * Deliberately not a heading size. It names the card you are already looking
 * at, so it should read as a tab on a folder rather than as a title competing
 * with the h1 above it. It is still an `<h2>` in the markup; only its
 * appearance is quiet.
 */
export function eyebrow(): string {
  return "text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]";
}

/** The surface a group of related things sits on. One border, one soft shadow. */
export function card(): string {
  return "rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card";
}

/**
 * Numbers and identifiers that are read digit by digit — a phone number, an SR
 * number, a token, a count, a date. Monospace so that 1 and 7 and 0 and O
 * cannot be confused, which matters when the whole point of the app is that
 * these are correct.
 */
export function mono(): string {
  return "font-mono text-xs text-[var(--color-ink-muted)]";
}

/**
 * The numeral on a wizard step — a small circle before the eyebrow.
 *
 * Only for sequences that genuinely have to happen in order (choose a class,
 * then choose fields, then choose a teacher; upload, then map, then dry-run).
 * Numbering cards that do not depend on each other tells the reader there is
 * an order to obey when there is not.
 */
export function stepBadge(): string {
  return "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-muted)] font-mono text-[11px] font-medium text-[var(--color-ink-muted)]";
}
