import { houseOf } from "@/lib/houses";

/**
 * A house, as a coloured chip.
 *
 * One of the very few places colour is allowed to be purely identifying rather
 * than semantic. A house is the field a child answers instantly and without
 * being asked twice, which makes this the fastest recognition cue on a card —
 * the teacher matches it before she has finished reading the name.
 *
 * The colour comes from the token layer through a template literal rather than
 * a class map, so renaming a house's colour stays one edit in tokens.css.
 * Lives here rather than in teacher/ because the student record shows it too.
 */
export function HouseChip({
  house,
  lang = "hi",
}: {
  house: string | null | undefined;
  /** The admin console reads English; the teacher surface reads Hindi. */
  lang?: "hi" | "en";
}) {
  const found = houseOf(house);
  if (!found) return null;

  return (
    <span
      lang={lang}
      className="rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `var(--color-house-${found.colour}-bg)`,
        color: `var(--color-house-${found.colour}-fg)`,
      }}
    >
      {lang === "hi" ? found.hi : found.name}
    </span>
  );
}
