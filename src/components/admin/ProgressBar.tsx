/**
 * A bar that says how far something has got.
 *
 * The same fifteen lines had been written out six times — the status board, the
 * students list, the round's send queue, and twice on the teacher surface — and
 * they had already drifted: three different colour policies, and only the two
 * teacher-surface copies carried `role="progressbar"` with its aria values. So
 * on the admin side a screen reader was told nothing at all; the number beside
 * the bar was the only thing it could reach, and on the students board that
 * number is `12/16` with no unit.
 *
 * TONE IS A PROP AND HAS NO DEFAULT COLOUR OF ITS OWN. The status board's bar
 * takes its row's tone deliberately — "a green bar sitting at 40% tells the
 * office the opposite of what the number beside it says" — while the students
 * board is threshold-coloured and the send queue is genuinely always green
 * because it counts messages that have gone. Those are three different
 * questions, so the component carries none of them and each caller says which
 * it is asking.
 *
 * The two TEACHER-surface bars stay where they are. ProgressRail is sticky, has
 * a collapsed variant that appears while the keyboard is up, and its own visual
 * QA; folding it in here is a separate change.
 */
export function ProgressBar({
  value,
  max,
  tone,
  label,
  className = "h-1.5",
}: {
  value: number;
  max: number;
  /** A Tailwind background class — the caller decides what the colour means. */
  tone: string;
  /** What is being measured, for anyone who cannot see the bar. */
  label: string;
  /** Height and width; the track's shape is otherwise fixed. */
  className?: string;
}) {
  // A zero denominator is an empty bar, never a full one. `0/0` reads as
  // finished to the arithmetic and as "nothing here" to a person.
  const percent = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));

  /*
   * SPANS, NOT DIVS, and not for style. The students board draws this inside a
   * <span> beside the count; a <div> there is flow content inside phrasing
   * content, which is invalid and is the kind of thing that renders fine until
   * a parser somewhere decides to restructure the DOM around it. A span set to
   * `block` is valid in both places and lays out identically.
   */
  return (
    <span
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={`block overflow-hidden rounded-full bg-[var(--color-surface-sunken)] ${className}`}
    >
      <span
        className={`block h-full rounded-full transition-[width] duration-300 ${tone}`}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
