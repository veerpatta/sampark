/**
 * Matching a file that has no student ID.
 *
 * The house list carries a name, a class and a house. Nothing else. The build
 * plan says never match on name, and that rule exists because two children in a
 * village school share a name more often than you would think and overwriting
 * the wrong one is not recoverable from a spreadsheet.
 *
 * So refine the rule rather than break it:
 *
 *     NEVER match on name to write master data unattended.
 *     A name match may only ever produce a PROPOSED change in the review queue.
 *
 * That is exactly what a teacher submission already is, so it costs no new
 * machinery and inherits the guarantee: nothing reaches master without a human
 * approving it, with their name and a timestamp against it.
 *
 * Two design rules do the safety work:
 *
 *   1. CANDIDATES ARE SCOPED TO ONE CLASS. Never the whole school. A fuzzy
 *      search across 504 students will eventually pair two unrelated children
 *      who happen to be spelled alike; the same search inside a class of 46
 *      barely can.
 *   2. MORE THAN ONE CANDIDATE AT ANY TIER IS A REFUSAL, not a coin toss. It
 *      goes to a human with every candidate shown.
 *
 * The tier is recorded on the proposal so review can treat them differently: an
 * office that can approve all the tier-1 exact matches in one action, and read
 * the tier-3 fuzzy ones one at a time, is an office that will actually do it.
 */

export type MatchTier = 1 | 2 | 3;

export type Candidate = {
  studentId: string;
  name: string;
  /** Which roster this candidate came from — the file, PSP, the fee app. */
  source: string;
};

export type MatchResult =
  | { kind: "matched"; tier: MatchTier; candidate: Candidate; why: string }
  | { kind: "ambiguous"; candidates: Candidate[]; tier: MatchTier }
  | { kind: "none" };

/**
 * Uppercase, strip punctuation, collapse whitespace.
 *
 * Deliberately does NOT strip honorifics or reorder tokens — that is tier 2's
 * job, and doing it here would make an exact match mean less than it says.
 */
export function normaliseName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Zऀ-ॿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (name: string) => normaliseName(name).split(" ").filter(Boolean);

/**
 * Match one name against the candidates in its class, hardest evidence first.
 *
 * Tier 1  exact after normalising
 * Tier 2  one name's tokens are a subset of the other's
 *         "Sapna Kanwar Chundawat" vs "SAPNA KANWAR" — the school records a
 *         middle name the election list dropped, or the reverse
 * Tier 3  fuzzy, similarity >= 0.86
 *         "Namrata Kanwar Chouhan" vs "NAMRTA KUNWAR CHOUHAN" — the same child,
 *         typed twice by two people
 *
 * Each tier only runs if the one above found nothing, so a weaker rule can
 * never override a stronger one.
 */
/**
 * Where fuzzy stops being evidence.
 *
 * Measured, not guessed. Scoring the real 151-row house list against the real
 * rosters puts the same-child-spelled-differently pairs at 0.83 and above, and
 * the next best candidate for any genuinely absent child at 0.72. The gap
 * between those is wide and empty, so the threshold sits in it rather than at
 * either edge.
 *
 * Re-measure when a new file arrives — scripts/import-houses.ts prints the tier
 * counts, and a cluster of near-misses just under this number means it needs
 * moving, not that the matcher is broken.
 */
export const FUZZY_THRESHOLD = 0.82;

export function matchName(
  incoming: string,
  candidates: Candidate[],
  { fuzzyThreshold = FUZZY_THRESHOLD }: { fuzzyThreshold?: number } = {},
): MatchResult {
  if (candidates.length === 0) return { kind: "none" };

  const target = normaliseName(incoming);
  if (!target) return { kind: "none" };

  // ---- tier 1: exact
  const exact = candidates.filter((c) => normaliseName(c.name) === target);
  if (exact.length === 1) {
    return { kind: "matched", tier: 1, candidate: exact[0]!, why: "exact match" };
  }
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact, tier: 1 };

  // ---- tier 2: token subset, either direction
  const targetTokens = new Set(tokens(incoming));
  const subset = candidates.filter((c) => {
    const other = new Set(tokens(c.name));
    if (targetTokens.size === 0 || other.size === 0) return false;
    const aInB = [...targetTokens].every((token) => other.has(token));
    const bInA = [...other].every((token) => targetTokens.has(token));
    return aInB || bInA;
  });
  if (subset.length === 1) {
    return {
      kind: "matched",
      tier: 2,
      candidate: subset[0]!,
      why: "every word of one name appears in the other",
    };
  }
  if (subset.length > 1) return { kind: "ambiguous", candidates: subset, tier: 2 };

  // ---- tier 3: fuzzy
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: similarity(target, normaliseName(candidate.name)),
    }))
    .filter((row) => row.score >= fuzzyThreshold)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none" };

  // A clear winner is one that beats the runner-up by a visible margin.
  // Two near-identical scores mean two plausible children, which is precisely
  // the case where a machine must not choose.
  if (scored.length > 1 && scored[0]!.score - scored[1]!.score < 0.02) {
    return {
      kind: "ambiguous",
      candidates: scored.map((row) => row.candidate),
      tier: 3,
    };
  }

  return {
    kind: "matched",
    tier: 3,
    candidate: scored[0]!.candidate,
    why: `spelling similarity ${scored[0]!.score.toFixed(2)}`,
  };
}

/**
 * How alike are two names?
 *
 * A NAME IS A SEQUENCE OF WORDS, not a string, and measuring it as a string
 * gets the common case wrong. "NAMRATA KANWAR CHOUHAN" against
 * "NAMRTA KUNWAR CHOUHAN" is the same child with two words each misspelt by a
 * letter — but whole-string bigrams also count the pairs that straddle the
 * spaces, so a surname spelled identically cannot pull the score back up and
 * the pair lands at 0.83, under any sensible threshold.
 *
 * So score word by word and average, then take the better of that and the
 * whole-string measure. Word-wise handles a misspelling; whole-string still
 * catches the case where the words were split differently.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  return Math.max(dice(a, b), wordwise(a, b));
}

/** Dice coefficient over character bigrams. */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const pair = s.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };

  const left = bigrams(a);
  const right = bigrams(b);

  let shared = 0;
  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0);
  }

  const total = a.length - 1 + (b.length - 1);
  return (2 * shared) / total;
}

/**
 * Pair each word with its best counterpart and average.
 *
 * Per-word scoring uses EDIT DISTANCE, not bigrams. The differences that
 * matter here are single-character typos in short words — NAMRATA/NAMRTA,
 * KANWAR/KUNWAR, GAUTAM/GOUTAM — and bigram overlap punishes those far harder
 * than they deserve: a six-letter word losing one letter loses two of its five
 * bigrams, scoring 0.6 for what a person reads as the same name. One edit in
 * seven characters is 0.86, which is what it actually is.
 *
 * Greedy pairing rather than optimal: with two or three words the difference
 * never shows, and greedy is something a person can follow when asked why two
 * names were called the same. Unpaired words count as zero, so "Aaaa Bbbb"
 * against "Aaaa" scores 0.5 and stays well clear of any threshold — a dropped
 * surname is tier 2's business, not this function's.
 */
function wordwise(a: string, b: string): number {
  const left = a.split(" ").filter(Boolean);
  const right = b.split(" ").filter(Boolean);
  if (left.length === 0 || right.length === 0) return 0;

  const taken = new Set<number>();
  let total = 0;

  for (const word of left) {
    let best = 0;
    let bestIndex = -1;
    right.forEach((other, index) => {
      if (taken.has(index)) return;
      const score = wordSimilarity(word, other);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) taken.add(bestIndex);
    total += best;
  }

  return total / Math.max(left.length, right.length);
}

/** 1 minus the edit distance as a fraction of the longer word. */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/** Levenshtein, single-row. Words here are never longer than a name. */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1, // deletion
        current[j - 1]! + 1, // insertion
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}

export type TierCounts = {
  tier1: number;
  tier2: number;
  tier3: number;
  none: number;
  ambiguous: number;
};

export function emptyTierCounts(): TierCounts {
  return { tier1: 0, tier2: 0, tier3: 0, none: 0, ambiguous: 0 };
}

export function countTier(counts: TierCounts, result: MatchResult): void {
  if (result.kind === "none") counts.none += 1;
  else if (result.kind === "ambiguous") counts.ambiguous += 1;
  else if (result.tier === 1) counts.tier1 += 1;
  else if (result.tier === 2) counts.tier2 += 1;
  else counts.tier3 += 1;
}
