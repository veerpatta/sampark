/**
 * The 29 bus routes, from the fee app's Routes sheet.
 *
 * "No Transport" is one of them and is a real answer, not a blank — a child who
 * walks to school has been asked and answered, and that is different from a
 * child nobody has asked.
 *
 * These are place names from the route master, not student data.
 *
 * This lives in src/lib rather than in the seed because runtime UI reads it now:
 * a route in-charge is assigned from this list in Settings, and a request can be
 * scoped to a route. A page importing from drizzle/seed would pull seed-time code
 * into the browser bundle. The seed re-exports from here, the same direction
 * HOUSES already runs.
 */
export const BUS_ROUTES = [
  "Aambaghati",
  "Agariya",
  "Agariya Kotari",
  "Aidana",
  "Amet Bus",
  "Amet City",
  "Amet College Road (Colony Inside)",
  "Amet College Side (On Road)",
  "Amet Railway Station (Inside)",
  "Amet Railway Station (On Road)",
  "Ballo Ka Khera",
  "Banda",
  "Bhakroda",
  "Bhopji Ka Kheda",
  "Dabla",
  "Dhelana",
  "Ghosundi",
  "Gugli",
  "Jilola",
  "Kanji Ka Kedha",
  "Karera",
  "Makarda",
  "Masingpura",
  "Mund Koshiya",
  "No Transport",
  "Saprav",
  "Sardargarh",
  "Selaguda",
  "Tanvan",
] as const;

export type BusRoute = (typeof BUS_ROUTES)[number];

const BY_NAME = new Map(BUS_ROUTES.map((route) => [route.toLowerCase(), route]));

/**
 * Collapse whitespace and match case-insensitively against the master list.
 *
 * Returns null for anything not on it. Several of these differ only by a
 * parenthesised suffix — "Amet Railway Station (Inside)" against "(On Road)" —
 * so a near-miss is a typo to refuse, never a new route to accept.
 */
export function normaliseRoute(raw: string): BusRoute | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return BY_NAME.get(cleaned.toLowerCase()) ?? null;
}

export function isBusRoute(value: string): value is BusRoute {
  return normaliseRoute(value) !== null;
}

export function unknownRouteMessage(value: string): string {
  return `"${value}" is not one of the ${BUS_ROUTES.length} bus routes. Check the spelling against Settings.`;
}
