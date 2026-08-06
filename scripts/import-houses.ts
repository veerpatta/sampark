import "../drizzle/env";
import { readFile } from "node:fs/promises";
import { parseTabularFile } from "../src/lib/excel";
import { planHouseImport } from "../src/lib/houses-import";
import { applySourcedPlan, planSourcedImport } from "../src/lib/import-plan";

/**
 * Import the house / election list.
 *
 *     npx tsx scripts/import-houses.ts private/election-houses.csv
 *     npx tsx scripts/import-houses.ts private/election-houses.csv --apply
 *
 * This file has no student ID, so every row is matched by name INSIDE ITS OWN
 * CLASS and the result is a proposal. `--apply` writes them as the `election`
 * source through precedence, which is the same gate every import passes; it
 * does not bypass review for anything a human has already decided.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const path = process.argv[2]!;

  const buffer = await readFile(path);
  const table = await parseTabularFile(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
    path,
  );

  console.log(`${path}: ${table.rows.length} rows`);

  const plan = await planHouseImport(table);

  console.log(`\n--- matcher tiers -------------------------------------`);
  console.log(`tier 1  exact                    ${plan.counts.tier1}`);
  console.log(`tier 2  token subset             ${plan.counts.tier2}`);
  console.log(`tier 3  fuzzy                    ${plan.counts.tier3}`);
  console.log(`tier 4  no candidate in class    ${plan.counts.none}`);
  console.log(`        AMBIGUOUS (refused)      ${plan.counts.ambiguous}`);
  console.log(
    `\nproposals: ${plan.proposals.length}   already correct: ${plan.settled.length}   problems: ${plan.problems.length}`,
  );

  const byTier = new Map<number, number>();
  for (const proposal of plan.proposals) {
    byTier.set(proposal.tier, (byTier.get(proposal.tier) ?? 0) + 1);
  }
  console.log(
    `proposals by tier: ${[...byTier.entries()].map(([t, n]) => `t${t}=${n}`).join(" ")}`,
  );

  // Tier 2 and 3 are the ones a human should actually read. Show the reasoning
  // without printing a real child's name — the repo is public and so is this
  // terminal output when it gets pasted somewhere.
  const soft = plan.proposals.filter((p) => p.tier > 1);
  console.log(`\nnon-exact matches needing a human eye: ${soft.length}`);
  for (const proposal of soft.slice(0, 6)) {
    console.log(
      `  tier ${proposal.tier} · ${proposal.classLabel} · ${proposal.why} · ${proposal.house}`,
    );
  }

  const problems = new Map<string, number>();
  for (const problem of plan.problems) {
    problems.set(problem.kind, (problems.get(problem.kind) ?? 0) + 1);
  }
  if (problems.size > 0) {
    console.log(`\nproblems:`);
    for (const [kind, n] of problems) console.log(`  ${kind.padEnd(14)} ${n}`);
  }

  const notFound = plan.problems.filter((p) => p.kind === "no-candidate");
  if (notFound.length > 0) {
    console.log(
      `\nin the house list, not in any roster for their class: ${notFound.length}`,
    );
    console.log(
      `  (a new admission nobody entered, or a name spelled two ways — both worth knowing)`,
    );
    const byClass = new Map<string, number>();
    for (const row of notFound) {
      byClass.set(row.classLabel, (byClass.get(row.classLabel) ?? 0) + 1);
    }
    for (const [label, n] of [...byClass].sort()) {
      console.log(`    ${label.padEnd(14)} ${n}`);
    }
  }

  if (!apply) {
    console.log(`\ndry run only — pass --apply to write`);
    return;
  }

  const sourced = await planSourcedImport(
    "election",
    // Settled rows carry no change but still need their provenance recorded —
    // an unclaimed value is one the next import overwrites.
    [...plan.proposals, ...plan.settled].map((row) => ({
      studentId: row.studentId,
      values: { house: row.house },
    })),
    // The election list knows a name and a house. A student record built from
    // that would have no class and no SR number, so it may never create one.
    { allowInsert: false },
  );

  console.log(`\nwould update ${sourced.counts.update}`);
  console.log(`refused by precedence ${sourced.counts.blocked}`);

  const result = await applySourcedPlan(sourced);
  console.log(`written: ${JSON.stringify(result)}`);
}

main().then(() => process.exit(0));
