/**
 * The four school houses.
 *
 * Named after the Mewar rulers, which is not decoration in Rajsamand — every
 * child knows these names, and a house is the one field a child answers
 * instantly and a teacher verifies at a glance. That makes it the strongest
 * recognition aid the roster has, so it renders as a coloured chip rather than
 * text in a dropdown.
 *
 * The election file writes them with a "House" suffix ("Rana Pratap House").
 * Store the short form; `normaliseHouse` strips the suffix on the way in.
 *
 * Colours are CSS variables, not hex, so a house chip and anything else keyed
 * to a house cannot drift apart. See src/styles/tokens.css.
 */
export const HOUSES = [
  { name: "Rana Pratap", hi: "राणा प्रताप", colour: "red" },
  { name: "Rana Kumbha", hi: "राणा कुम्भा", colour: "blue" },
  { name: "Bappa Rawal", hi: "बप्पा रावल", colour: "green" },
  { name: "Rana Sanga", hi: "राणा सांगा", colour: "yellow" },
] as const;

export type HouseName = (typeof HOUSES)[number]["name"];

const BY_NAME = new Map(HOUSES.map((house) => [house.name.toLowerCase(), house]));

/**
 * "Rana Sanga House" -> "Rana Sanga". Returns null for anything that is not one
 * of the four, because a fifth house is a typo, not a new house.
 */
export function normaliseHouse(raw: string): HouseName | null {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+house$/i, "");
  return (BY_NAME.get(cleaned.toLowerCase())?.name as HouseName) ?? null;
}

export function houseOf(name: string | null | undefined) {
  if (!name) return null;
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}
