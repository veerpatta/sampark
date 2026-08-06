import "../drizzle/env";
import { readFile } from "node:fs/promises";
import { db, schema } from "../src/lib/db";
import { parseTabularFile, FORMAT_LABEL } from "../src/lib/excel";
import { readPspTable } from "../src/lib/psp";
import { applySourcedPlan, planSourcedImport } from "../src/lib/import-plan";

/**
 * Import the PSP Student Data Entry Report.
 *
 *     npx tsx scripts/import-psp.ts private/psp-a.xls private/psp-b.xls
 *     npx tsx scripts/import-psp.ts private/psp-*.xls --apply
 *
 * PSP is authoritative for identity and NOT for class allocation, so the class
 * PSP reports is compared against the fee app and listed as a conflict for the
 * office rather than written. See drizzle/seed/sources.ts.
 *
 * Everything goes through planSourcedImport, which means precedence applies:
 * an approved teacher correction is never overwritten, and the dry run says so
 * out loud.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

  const rows = [];
  const readErrors = [];
  const duplicateSrNos = new Map<string, string[]>();

  for (const path of paths) {
    const buffer = await readFile(path);
    const table = await parseTabularFile(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
      path,
    );
    const read = readPspTable(table);
    console.log(
      `${path}: ${FORMAT_LABEL[table.format ?? "xlsx"]}, ${read.rows.length} rows, ${read.errors.length} unreadable`,
    );
    rows.push(...read.rows);
    readErrors.push(...read.errors);
    for (const [sr, ids] of read.duplicateSrNos) duplicateSrNos.set(sr, ids);
  }

  console.log(`\ntotal PSP rows: ${rows.length}`);

  // SR No. is NOT unique — three SR numbers are each shared by two different
  // children. Keyed on Student NIC ID, this is a report, not a problem.
  const srSeen = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.srNo) continue;
    srSeen.set(row.srNo, [...(srSeen.get(row.srNo) ?? []), row.id]);
  }
  const collisions = [...srSeen.entries()].filter(([, ids]) => ids.length > 1);
  console.log(
    `SR numbers claimed by more than one NIC ID: ${collisions.length} (keyed on NIC ID, so harmless)`,
  );

  const nicIds = new Set(rows.map((row) => row.id));
  console.log(`unique NIC IDs: ${nicIds.size}`);

  /* ---------------------------------------------- join against the fee app */
  const existing = await db.select().from(schema.students);
  const bySr = new Map<string, typeof existing>();
  for (const student of existing) {
    if (!student.srNo) continue;
    bySr.set(student.srNo, [...(bySr.get(student.srNo) ?? []), student]);
  }

  const conflicts: string[] = [];
  const incoming = [];
  let joined = 0;
  let ambiguousSr = 0;

  /**
   * Which PSP rows want to write to which master student.
   *
   * SR No. is NOT unique in PSP: three SR numbers are each shared by two
   * DIFFERENT children, born five years apart. The fee app's SR numbers ARE
   * unique, so both PSP children resolve to the same master record and the
   * second one silently overwrites the first — one child's name, DOB and
   * parents landing on another child's row, with nothing in the output to say
   * so. Refuse both and make the office resolve it.
   */
  const claimedBy = new Map<string, typeof rows>();
  for (const row of rows) {
    const match = row.srNo ? (bySr.get(row.srNo) ?? [])[0] : undefined;
    const target = match ? match.id : row.id;
    claimedBy.set(target, [...(claimedBy.get(target) ?? []), row]);
  }
  const merges = [...claimedBy.entries()].filter(([, list]) => list.length > 1);

  for (const row of rows) {
    // The fee app imported with SR no as its id, so joining on SR is joining on
    // the fee app's key. Ambiguity is refused rather than guessed.
    const candidates = row.srNo ? (bySr.get(row.srNo) ?? []) : [];
    if (candidates.length > 1) {
      ambiguousSr += 1;
      continue;
    }
    const match = candidates[0];
    const target = match ? match.id : row.id;

    // Two PSP children claiming one master record. Neither is written.
    if ((claimedBy.get(target)?.length ?? 0) > 1) continue;

    if (match) {
      joined += 1;
      if (row.classLabel && row.classLabel !== match.classLabel) {
        conflicts.push(
          `${match.id}\tfee app: ${match.classLabel}\tPSP: ${row.classLabel}`,
        );
      }
    }

    incoming.push({
      studentId: match ? match.id : row.id,
      values: {
        name: row.name,
        father_name: row.fatherName,
        mother_name: row.motherName,
        dob: row.dob,
        gender: row.gender,
        category: row.category,
        phone: row.phone,
        address: row.address,
        aadhaar_last4: row.aadhaarLast4,
        // class_label is deliberately ABSENT. The fee app owns it; precedence
        // would block it anyway, but not offering it keeps the dry run honest
        // about what PSP is actually trying to do.
      },
      insertDefaults: {
        sr_no: row.srNo,
        // A PSP student the fee app has never seen still needs a class to be a
        // valid record. PSP's is the only one available for them.
        class_label: row.classLabel,
      },
      warnings: row.warnings,
    });
  }

  console.log(`joined to an existing student by SR: ${joined}`);
  console.log(`only in PSP (would be created): ${incoming.length - joined}`);
  console.log(`refused — ambiguous SR: ${ambiguousSr}`);

  if (merges.length > 0) {
    console.log(
      `\nREFUSED — ${merges.length} master records claimed by two PSP children each.`,
    );
    console.log(`These are the real SR collisions. Nothing is written for them:`);
    for (const [target, list] of merges) {
      console.log(
        `  student ${target}: NIC IDs ${list.map((row) => row.id).join(" and ")}` +
          ` (SR ${list[0]!.srNo}, born ${list.map((row) => row.dob?.slice(0, 4) ?? "?").join(" and ")})`,
      );
    }
  }

  const feeOnly = existing.filter(
    (student) => student.srNo && !srSeen.has(student.srNo),
  );
  console.log(`only in the fee app (kept, PSP has never seen them): ${feeOnly.length}`);

  /* ------------------------------------------------------------ the plan */
  const plan = await planSourcedImport("psp", incoming, { allowInsert: true });

  console.log(`\n--- dry run -------------------------------------------`);
  console.log(`would insert                     ${plan.counts.insert}`);
  console.log(`would update                     ${plan.counts.update}`);
  console.log(`would skip (already matches)     ${plan.counts.skip}`);
  console.log(`would skip (lower precedence)    ${plan.counts.blocked}`);
  console.log(`errors                           ${plan.counts.error}`);

  // Per field, so "489 updated" does not hide WHAT moved. The interesting one
  // is phone: PSP disagrees with the fee app for about a quarter of the school,
  // and those students are the first useful teacher task — a number two systems
  // disagree about is more worth checking than one that is merely absent.
  const changedFields = new Map<string, number>();
  for (const row of plan.rows) {
    for (const change of row.changes) {
      if (change.from === null) continue; // filling a blank is not a dispute
      changedFields.set(
        change.fieldKey,
        (changedFields.get(change.fieldKey) ?? 0) + 1,
      );
    }
  }
  if (changedFields.size > 0) {
    console.log("\nvalues PSP DISAGREED with and replaced, per field:");
    for (const [field, n] of [...changedFields].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(16)} ${n}`);
    }
  }

  const blockedFields = new Map<string, number>();
  for (const row of plan.rows) {
    for (const item of row.blocked) {
      blockedFields.set(item.fieldKey, (blockedFields.get(item.fieldKey) ?? 0) + 1);
    }
  }
  if (blockedFields.size > 0) {
    console.log("\nrefused by precedence, per field:");
    for (const [field, n] of blockedFields) console.log(`  ${field.padEnd(16)} ${n}`);
  }

  const warned = plan.rows.filter((row) => row.warnings.length > 0);
  console.log(`\nrows with warnings: ${warned.length}`);
  for (const row of warned.slice(0, 5)) {
    console.log(`  ${row.warnings.join("; ")}`);
  }

  console.log(`\nGENUINE CLASS CONFLICTS (fee app wins; office decides): ${conflicts.length}`);
  for (const line of conflicts) console.log(`  ${line}`);

  if (readErrors.length > 0) {
    console.log(`\nunreadable rows: ${readErrors.length}`);
    for (const row of readErrors.slice(0, 5)) {
      console.log(`  row ${row.rowNumber}: ${row.error}`);
    }
  }

  if (apply) {
    const result = await applySourcedPlan(plan);
    console.log(`\nwritten: ${JSON.stringify(result)}`);
  } else {
    console.log(`\ndry run only — pass --apply to write`);
  }
}

main().then(() => process.exit(0));
