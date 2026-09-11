import { matchName, type Candidate, type MatchResult } from "./name-match";

/**
 * Which child a photo file is of, from its filename alone.
 *
 * WHY THIS EXISTS. The office's half of a photo round is not forty-six children
 * with a camera — it is a folder somebody already filled, from a studio visit,
 * an ID-card batch, or last year's export. Tapping five hundred tiles to attach
 * five hundred files one at a time is the job this is meant to remove.
 *
 * PURE, AND THAT IS THE POINT. No DOM, no database, no fetch — so the rule that
 * decides which child a file belongs to is testable on its own, the way
 * autosave.ts and name-match.ts are. Getting this wrong attaches a photograph
 * of one child to another child's record, which is not recoverable by looking
 * at a spreadsheet.
 *
 * THE RULE, hardest evidence first, and it is name-match.ts's rule:
 *
 *   1. A student id appearing as a whole token in the filename.
 *   2. An SR number appearing as a whole token.
 *   3. The child's name, delegated to matchName and SCOPED TO ONE CLASS.
 *
 * MORE THAN ONE CANDIDATE AT ANY TIER IS A REFUSAL, never a coin toss. An
 * unmatched or ambiguous file goes to a tray for a human to place, which is the
 * same trade the review queue makes everywhere else in this app: a machine that
 * guesses is worse than a machine that asks, when the cost of a wrong guess is
 * a child's face on the wrong record.
 *
 * NOTHING HERE WRITES ANYTHING. A match produces an intention — this file, that
 * student — which then travels the ordinary road: downscale, upload against the
 * request's own token, photoBelongsTo, the answer flush, and the review queue.
 */

export type PhotoTarget = {
  studentId: string;
  name: string;
  /** Used to scope a name match, per rule 3. Null for a child with no class. */
  classLabel: string | null;
  srNo: string | null;
};

export type FilenameMatch =
  | { kind: "matched"; studentId: string; by: "id" | "sr" | "name"; why: string }
  | { kind: "ambiguous"; studentIds: string[]; why: string }
  | { kind: "none" };

/**
 * Everything in a filename that could be an identifier.
 *
 * Split on anything that is not a letter or a digit, so `IMG_20260903_S1001
 * (2).jpeg` yields IMG, 20260903, S1001, 2 — and `S1001.jpg` yields S1001. The
 * extension is dropped first so `1234.jpg` cannot match a student whose SR
 * number is "jpg", which is silly but free to rule out.
 *
 * A student id may contain `/` and a space (nine RTE children are `228/12RTE`),
 * and neither survives a filename intact — Windows forbids the slash outright.
 * So the comparison is made on a SANITISED form of both sides: strip everything
 * but letters and digits from the id too, and `228 12RTE.jpg` or
 * `22812RTE.jpg` both still find `228/12RTE`. That is a widening of what
 * matches, and it is safe here because the result is still checked against
 * exactly one roster and a second hit is a refusal.
 */
export function tokensOf(filename: string): string[] {
  const withoutExtension = filename.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return withoutExtension
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Letters and digits only, uppercased. Applied to both sides of a comparison. */
export function sanitiseKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * A student id that arrived split across tokens.
 *
 * `228/12RTE` becomes "228" and "12RTE" in a filename, and neither alone is the
 * id. Joining adjacent tokens pairwise recovers it without inventing a parser:
 * two tokens is as far as this goes, because three would start matching a date
 * against an id by accident.
 */
function joinedPairs(tokens: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    pairs.push(tokens[i]! + tokens[i + 1]!);
  }
  return pairs;
}

function uniqueBy(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Match one filename against one roster.
 *
 * The roster is the request's own frozen roster and nothing wider, so a master
 * link matches against the round's children and a class link against hers.
 */
export function matchFilename(
  filename: string,
  roster: PhotoTarget[],
): FilenameMatch {
  if (roster.length === 0) return { kind: "none" };

  const tokens = tokensOf(filename);
  if (tokens.length === 0) return { kind: "none" };

  const keys = new Set(
    [...tokens, ...joinedPairs(tokens)].map(sanitiseKey).filter(Boolean),
  );

  // ---- tier 1: the student id, as a whole token
  const byId = roster.filter((target) => keys.has(sanitiseKey(target.studentId)));
  if (byId.length === 1) {
    return {
      kind: "matched",
      studentId: byId[0]!.studentId,
      by: "id",
      why: `filename contains ${byId[0]!.studentId}`,
    };
  }
  if (byId.length > 1) {
    return {
      kind: "ambiguous",
      studentIds: uniqueBy(byId.map((target) => target.studentId)),
      why: "more than one student id appears in the filename",
    };
  }

  // ---- tier 2: the SR number, as a whole token
  const bySr = roster.filter(
    (target) => target.srNo && keys.has(sanitiseKey(target.srNo)),
  );
  if (bySr.length === 1) {
    return {
      kind: "matched",
      studentId: bySr[0]!.studentId,
      by: "sr",
      why: `filename contains SR ${bySr[0]!.srNo}`,
    };
  }
  if (bySr.length > 1) {
    return {
      kind: "ambiguous",
      studentIds: uniqueBy(bySr.map((target) => target.studentId)),
      why: "more than one SR number appears in the filename",
    };
  }

  return matchByName(filename, tokens, roster);
}

/**
 * Tier 3, delegated to name-match.ts and scoped to one class.
 *
 * SCOPING IS THE SAFETY RULE, not a performance one — it is written down at the
 * head of name-match.ts. A fuzzy search across five hundred children will
 * eventually pair two who are spelled alike; the same search inside a class of
 * forty-six barely can. So a name is matched inside each class separately and a
 * hit in two different classes is an ambiguity, not a winner.
 */
function matchByName(
  filename: string,
  tokens: string[],
  roster: PhotoTarget[],
): FilenameMatch {
  // The alphabetic part of the filename is the only part that can be a name;
  // leaving "IMG" and "20260903" in would drag every candidate's score down.
  const words = tokens.filter((token) => /^[A-Za-z]+$/.test(token));
  if (words.length === 0) return { kind: "none" };
  const spelled = words.join(" ");

  const byClass = new Map<string, Candidate[]>();
  for (const target of roster) {
    const key = target.classLabel ?? "";
    const list = byClass.get(key) ?? [];
    list.push({ studentId: target.studentId, name: target.name, source: "file" });
    byClass.set(key, list);
  }

  const hits: { studentId: string; result: Extract<MatchResult, { kind: "matched" }> }[] =
    [];
  const ambiguous: string[] = [];

  for (const candidates of byClass.values()) {
    const result = matchName(spelled, candidates);
    if (result.kind === "matched") {
      hits.push({ studentId: result.candidate.studentId, result });
    } else if (result.kind === "ambiguous") {
      ambiguous.push(...result.candidates.map((candidate) => candidate.studentId));
    }
  }

  if (hits.length === 1 && ambiguous.length === 0) {
    return {
      kind: "matched",
      studentId: hits[0]!.studentId,
      by: "name",
      why: hits[0]!.result.why,
    };
  }

  const all = uniqueBy([...hits.map((hit) => hit.studentId), ...ambiguous]);
  if (all.length > 1) {
    return {
      kind: "ambiguous",
      studentIds: all,
      why: "the name in the filename fits more than one child",
    };
  }

  return { kind: "none" };
}

export type PlacedFile = {
  filename: string;
  match: FilenameMatch;
};

/**
 * Place a whole drop at once, and never put two files on one child.
 *
 * TWO FILES MATCHING THE SAME CHILD IS A REFUSAL OF BOTH. A folder holding
 * `S1001.jpg` and `S1001 (1).jpg` is somebody's retake, and silently taking
 * whichever the browser listed first is the app choosing which photograph of a
 * child is the real one. Neither is attached; both go to the tray, where a
 * person can see the two side by side and pick.
 *
 * Order is the caller's — a FileList as the browser gave it — and is preserved,
 * so the tray reads in the same order as the folder.
 */
export function placeFiles(
  filenames: string[],
  roster: PhotoTarget[],
): PlacedFile[] {
  const first = filenames.map((filename) => ({
    filename,
    match: matchFilename(filename, roster),
  }));

  const claims = new Map<string, number>();
  for (const placed of first) {
    if (placed.match.kind !== "matched") continue;
    claims.set(
      placed.match.studentId,
      (claims.get(placed.match.studentId) ?? 0) + 1,
    );
  }

  return first.map((placed) => {
    if (placed.match.kind !== "matched") return placed;
    if ((claims.get(placed.match.studentId) ?? 0) <= 1) return placed;
    return {
      filename: placed.filename,
      match: {
        kind: "ambiguous",
        studentIds: [placed.match.studentId],
        why: "more than one file in this drop is for the same child",
      },
    };
  });
}
