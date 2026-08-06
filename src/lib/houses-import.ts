import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { isClassLabel, normaliseClassLabel } from "./classes";
import { normaliseHouse } from "./houses";
import {
  countTier,
  emptyTierCounts,
  matchName,
  type Candidate,
  type MatchTier,
  type TierCounts,
} from "./name-match";
import type { ParsedTable } from "./excel";

/**
 * The election / house list: 151 students, a field nothing else holds.
 *
 * It has no SR number and no NIC ID — only a name, a class and a house. So
 * every row goes through the class-scoped tiered matcher and lands as a
 * PROPOSED change, never as a direct write. See lib/name-match.ts for why that
 * is a refinement of "never match on name" rather than a breach of it.
 *
 * Candidates come from the whole master record, not one source. Of the 18 rows
 * with no fee-app match, 7 are in PSP — a single-source matcher would have
 * thrown those children away.
 */

export type HouseProposal = {
  rowNumber: number;
  voterName: string;
  classLabel: string;
  house: string;
  studentId: string;
  studentName: string;
  tier: MatchTier;
  why: string;
  /** What we already hold, so review shows a real before/after. */
  currentHouse: string | null;
};

export type HouseProblem = {
  rowNumber: number;
  voterName: string;
  classLabel: string;
  house: string | null;
  kind: "ambiguous" | "no-candidate" | "bad-class" | "bad-house";
  detail: string;
  candidates?: { studentId: string; name: string }[];
};

export type HouseImportPlan = {
  proposals: HouseProposal[];
  problems: HouseProblem[];
  counts: TierCounts;
  /**
   * Matches that already hold exactly this house. Nothing to change, but they
   * are still carried through the apply path so provenance can be recorded —
   * a value nobody claims is a value the next import overwrites.
   */
  settled: { studentId: string; house: string }[];
};

type Row = { voterName: string; classLabel: string; house: string; rowNumber: number };

export function readHouseTable(table: ParsedTable): Row[] {
  const pick = (row: Record<string, string>, ...names: string[]) => {
    for (const name of names) {
      const value = row[name];
      if (value !== undefined) return value.trim();
    }
    return "";
  };

  return table.rows
    .map((row, index) => ({
      voterName: pick(row, "Voter Name"),
      classLabel: pick(row, "Class & Section", "Class"),
      house: pick(row, "House"),
      rowNumber: index + 2,
    }))
    // Roll Number / Admission Number is empty in every one of the 151 rows.
    // Ignored rather than mapped, so nobody later assumes it can be a key.
    .filter((row) => row.voterName !== "");
}

export async function planHouseImport(
  table: ParsedTable,
): Promise<HouseImportPlan> {
  const rows = readHouseTable(table);

  const proposals: HouseProposal[] = [];
  const problems: HouseProblem[] = [];
  const counts = emptyTierCounts();
  const settled: { studentId: string; house: string }[] = [];

  // Candidates are looked up one class at a time. Class scoping is what keeps
  // this safe, so the roster cache is keyed by class and never merged.
  const rosters = new Map<string, Candidate[]>();
  const currentHouses = new Map<string, string | null>();

  const classLabels = [
    ...new Set(rows.map((row) => normaliseClassLabel(row.classLabel))),
  ].filter(isClassLabel);

  if (classLabels.length > 0) {
    const students = await db
      .select({
        id: schema.students.id,
        name: schema.students.name,
        classLabel: schema.students.classLabel,
        house: schema.students.house,
        source: schema.students.source,
      })
      .from(schema.students)
      .where(
        and(
          inArray(schema.students.classLabel, classLabels),
          eq(schema.students.status, "active"),
        ),
      );

    for (const student of students) {
      const list = rosters.get(student.classLabel) ?? [];
      list.push({
        studentId: student.id,
        name: student.name,
        source: student.source ?? "unknown",
      });
      rosters.set(student.classLabel, list);
      currentHouses.set(student.id, student.house);
    }
  }

  for (const row of rows) {
    const classLabel = normaliseClassLabel(row.classLabel);
    const house = normaliseHouse(row.house);

    // The file already uses the fee app's labels exactly ("Class 8",
    // "11 Science"), so a mismatch here means the file changed, not that a
    // mapping is missing.
    if (!isClassLabel(classLabel)) {
      problems.push({
        rowNumber: row.rowNumber,
        voterName: row.voterName,
        classLabel: row.classLabel,
        house,
        kind: "bad-class",
        detail: `"${row.classLabel}" is not one of the 19 classes`,
      });
      continue;
    }

    if (!house) {
      problems.push({
        rowNumber: row.rowNumber,
        voterName: row.voterName,
        classLabel,
        house: null,
        kind: "bad-house",
        detail: `"${row.house}" is not one of the four houses`,
      });
      continue;
    }

    const result = matchName(row.voterName, rosters.get(classLabel) ?? []);
    countTier(counts, result);

    if (result.kind === "ambiguous") {
      problems.push({
        rowNumber: row.rowNumber,
        voterName: row.voterName,
        classLabel,
        house,
        kind: "ambiguous",
        detail: `${result.candidates.length} children in ${classLabel} match at tier ${result.tier}`,
        candidates: result.candidates.map((c) => ({
          studentId: c.studentId,
          name: c.name,
        })),
      });
      continue;
    }

    if (result.kind === "none") {
      problems.push({
        rowNumber: row.rowNumber,
        voterName: row.voterName,
        classLabel,
        house,
        kind: "no-candidate",
        // Worth knowing rather than discarding: this is either a new admission
        // nobody entered, or a name spelled two different ways.
        detail: `in the house list, not in any roster for ${classLabel}`,
      });
      continue;
    }

    const current = currentHouses.get(result.candidate.studentId) ?? null;
    if (current === house) {
      settled.push({ studentId: result.candidate.studentId, house });
      continue;
    }

    proposals.push({
      rowNumber: row.rowNumber,
      voterName: row.voterName,
      classLabel,
      house,
      studentId: result.candidate.studentId,
      studentName: result.candidate.name,
      tier: result.tier,
      why: result.why,
      currentHouse: current,
    });
  }

  /**
   * Two rows proposing for the SAME child.
   *
   * Each row is matched independently, so two differently-spelled names in one
   * class can both land on one student. Writing both would mean the second
   * house silently winning and one real child's house being lost — and since
   * the two rows disagree about which house, one of them is wrong. Refuse both
   * and show the office what happened.
   */
  const byStudent = new Map<string, HouseProposal[]>();
  for (const proposal of proposals) {
    byStudent.set(proposal.studentId, [
      ...(byStudent.get(proposal.studentId) ?? []),
      proposal,
    ]);
  }

  const contested = new Set<string>();
  for (const [studentId, list] of byStudent) {
    if (list.length < 2) continue;
    contested.add(studentId);
    for (const proposal of list) {
      problems.push({
        rowNumber: proposal.rowNumber,
        voterName: proposal.voterName,
        classLabel: proposal.classLabel,
        house: proposal.house,
        kind: "ambiguous",
        detail:
          `${list.length} rows in the house list matched the same child in ` +
          `${proposal.classLabel} (houses: ${[...new Set(list.map((p) => p.house))].join(", ")})`,
        candidates: [{ studentId, name: proposal.studentName }],
      });
    }
  }

  return {
    proposals: proposals.filter((p) => !contested.has(p.studentId)),
    problems,
    counts,
    settled: settled.filter((row) => !contested.has(row.studentId)),
  };
}
