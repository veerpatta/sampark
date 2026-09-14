import "../drizzle/env";
import { and, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { readPhotoFor } from "../src/lib/photo-store";
import { clearPhotoDefect, recordPhotoDefect } from "../src/lib/photo-marks";
import {
  PHOTO_DEFECT_LABELS,
  photoDefect,
  type PhotoDefect,
} from "../src/lib/photo-health";

/**
 * Open every photograph the school holds, and write down the ones that will not.
 *
 *   npm run photos:verify          # checks, and marks what it finds
 *   npm run photos:verify -- --dry # checks, writes nothing, prints the list
 *
 * WHY A SWEEP AND NOT ONLY THE PROXY. /api/photos notices a broken photograph
 * the moment somebody looks at one, which covers every face the office scrolls
 * past — but it only ever sees the photographs it is ASKED for, and it is asked
 * for a child's photograph exactly until that child is marked. So it can find a
 * broken photo and can never find out that one has come back. Both edges belong
 * here: this is the pass that marks the children nobody has looked at lately,
 * and the only thing in the app that takes a mark off again.
 *
 * RUN IT AFTER THE MIGRATION THAT ADDED THE COLUMNS. Every photograph already
 * in the store is unexamined until something examines it, so the first run is
 * what turns a school's worth of silently broken faces into a work list.
 *
 * IT WILL REFUSE TO MARK THE WHOLE SCHOOL. A bad BLOB_READ_WRITE_TOKEN or a
 * Hobby-plan limit makes every read fail identically, and a sweep that believed
 * it would put five hundred children back on the photo list and send nineteen
 * teachers out to re-photograph a school whose photographs are all perfectly
 * fine. A run of store-level failures stops it dead instead. See ABORT_AFTER.
 */

const DRY = process.argv.includes("--dry");

/**
 * Eight at a time.
 *
 * lib/photo-store.ts fans out to sixteen for an export, against a Hobby ceiling
 * of 1,200 blob operations a minute. This is the background job, not the thing
 * the office is waiting on, so it takes the quieter half of that budget and
 * leaves the rest for whoever is using the app while it runs.
 */
const CONCURRENCY = 8;

/**
 * Consecutive store-level failures before this gives up.
 *
 * 'unreadable' means the store answered wrongly or not at all — a credential, a
 * plan limit, a network. 'missing' means the store answered plainly that the
 * blob is not there, which is a real finding about one child and never a reason
 * to stop. Twelve in a row of the first kind is not twelve unlucky children.
 */
const ABORT_AFTER = 12;

type Row = {
  id: string;
  name: string;
  classLabel: string;
  photoPath: string;
  photoBrokenPath: string | null;
  photoBrokenReason: string | null;
};

type Finding = { row: Row; defect: PhotoDefect | null; wasMarked: boolean };

async function main() {
  const rows = (await db
    .select({
      id: schema.students.id,
      name: schema.students.name,
      classLabel: schema.students.classLabel,
      photoPath: schema.students.photoPath,
      photoBrokenPath: schema.students.photoBrokenPath,
      photoBrokenReason: schema.students.photoBrokenReason,
    })
    .from(schema.students)
    // EVERY STATUS, including the children who have left. Their records are
    // still printed and still exported, and a transfer certificate is the last
    // moment a photograph is wanted — the worst possible time to find out.
    .where(
      and(isNotNull(schema.students.photoPath), ne(schema.students.photoPath, "")),
    )
    .orderBy(schema.students.classLabel, schema.students.name)) as Row[];

  console.log(
    `${rows.length} ${rows.length === 1 ? "photograph" : "photographs"} to open${DRY ? " (dry run — nothing will be written)" : ""}.`,
  );
  if (rows.length === 0) return;

  const findings: Finding[] = [];
  let unreadableRun = 0;
  let aborted = false;
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      for (let i = cursor++; i < rows.length && !aborted; i = cursor++) {
        const row = rows[i]!;
        const { defect } = await readPhotoFor(row.photoPath);

        if (defect === "unreadable") {
          if (++unreadableRun >= ABORT_AFTER) aborted = true;
        } else {
          unreadableRun = 0;
        }

        findings.push({
          row,
          defect,
          wasMarked: photoDefect(row) !== null,
        });
      }
    }),
  );

  if (aborted) {
    console.error(
      `\nSTOPPED after ${ABORT_AFTER} photographs in a row that the store would not return.\n` +
        "That is the blob store failing, not the school's photographs. Check\n" +
        "BLOB_READ_WRITE_TOKEN and the store's plan limits, then run this again.\n" +
        "Nothing has been written.",
    );
    process.exitCode = 1;
    return;
  }

  const broken = findings.filter((f) => f.defect !== null);
  const healed = findings.filter((f) => f.defect === null && f.wasMarked);

  // WRITE AFTER READING EVERYTHING, so the abort above can protect every row
  // rather than only the ones it had not reached yet.
  let marked = 0;
  let cleared = 0;
  if (!DRY) {
    for (const finding of broken) {
      marked += (await recordPhotoDefect(finding.row.photoPath, finding.defect!)).length;
    }
    for (const finding of healed) {
      cleared += (await clearPhotoDefect(finding.row.photoPath)).length;
    }
  }

  report(findings, broken, healed, marked, cleared);
}

function report(
  findings: Finding[],
  broken: Finding[],
  healed: Finding[],
  marked: number,
  cleared: number,
) {
  const good = findings.length - broken.length;
  console.log(`\n${good} opened cleanly.`);

  if (broken.length > 0) {
    console.log(`\n${broken.length} will not open:\n`);
    const byDefect = new Map<PhotoDefect, Finding[]>();
    for (const finding of broken) {
      const list = byDefect.get(finding.defect!) ?? [];
      list.push(finding);
      byDefect.set(finding.defect!, list);
    }
    for (const [defect, list] of byDefect) {
      console.log(`  ${PHOTO_DEFECT_LABELS[defect]} — ${list.length}`);
      for (const { row } of list) {
        console.log(`    ${row.id.padEnd(10)} ${row.classLabel.padEnd(10)} ${row.name}`);
      }
      console.log("");
    }
  }

  if (healed.length > 0) {
    console.log(`${healed.length} marked broken before now open again.\n`);
  }

  if (DRY) {
    console.log("Dry run: nothing was written.");
    return;
  }

  console.log(
    `Marked ${marked} newly broken, cleared ${cleared}.\n` +
      (marked > 0
        ? "Those children now count as having no photograph: they are in the\n" +
          '"No photo" filter on /students and a photo round will ask for them.\n'
        : ""),
  );
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
