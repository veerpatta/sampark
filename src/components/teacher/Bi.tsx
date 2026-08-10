import type { Phrase } from "./strings";

/**
 * One phrase, twice: English at the size the surrounding element already has,
 * Hindi under it, smaller and quieter.
 *
 * ONE COMPONENT DECIDES THE RATIO. The alternative — an English span and a
 * Hindi span written out at each of ninety call sites — drifts within a week:
 * one heading ends up with the Hindi at the same weight as the English, one
 * button loses its Hindi entirely, and nobody notices because each one looks
 * fine on its own.
 *
 * `lang` on each half is not decoration. tokens.css hands `:lang(hi)` the
 * Devanagari cut of Anek, so the Hindi gets the right font from the attribute
 * rather than from a class somebody has to remember; and a screen reader that
 * announces both halves pronounces each in its own language instead of reading
 * Devanagari with an English voice.
 *
 * The Hindi line is `block` so it always sits under the English, including
 * inside a button — which is why every button that carries one has min-h-12
 * rather than a fixed height.
 */
export function Bi({
  t,
  className,
  hi = true,
}: {
  t: Phrase;
  /** Classes for the English half only. */
  className?: string;
  /**
   * Drop the Hindi line. For the few places a second line would break the
   * layout outright — a table cell, a chip, a line already at two lines.
   */
  hi?: boolean;
}) {
  return (
    <>
      <span lang="en" className={className}>
        {t.en}
      </span>
      {hi ? (
        <span
          lang="hi"
          className="mt-0.5 block text-meta font-normal leading-tight opacity-70"
        >
          {t.hi}
        </span>
      ) : null}
    </>
  );
}
