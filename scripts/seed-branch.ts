import "../drizzle/env";
import { execFileSync } from "node:child_process";

/**
 * Seed the field registry on a Neon branch other than the one .env.local points
 * at.
 *
 *   npm run db:seed:branch -- ep-summer-art-azhmd10t
 *
 * The companion to migrate-branch.ts, and needed for the same reason: schema,
 * roles, grants AND seed data are all per-branch. `vercel-dev` sat with all six
 * migrations applied and an empty `field_defs` for long enough to be worth a
 * command — a branch with the tables but no field registry does not fail at
 * deploy, it fails later on the first screen that reads the registry, which is
 * a much worse place to find out.
 *
 * Takes only the compute id and rewrites the host of the existing owner
 * connection string, so there is no second credential to store. The URL is
 * never printed.
 */
const endpoint = process.argv[2];
if (!endpoint) {
  console.error(
    "Usage: npm run db:seed:branch -- <compute-id>\n" +
      "Find it in the Neon console, or with the branch list.",
  );
  process.exit(1);
}
if (!/^ep-[a-z0-9-]+$/.test(endpoint)) {
  console.error("That does not look like a Neon compute id (ep-...).");
  process.exit(1);
}

const owner = process.env.DATABASE_URL_UNPOOLED;
if (!owner) {
  throw new Error("DATABASE_URL_UNPOOLED must be set — seeding runs as owner.");
}

const url = new URL(owner);
// Swap only the endpoint id; region, project suffix and credentials all stay.
url.hostname = url.hostname.replace(/^ep-[^.]+/, endpoint);

console.log(`Seeding ${endpoint} …`);

// A child process, for the same reason migrate-branch.ts uses one: the seed
// ends in process.exit(0), and reached through a dynamic import from here that
// tears the loop down under an open Neon socket — on Windows libuv asserts and
// the command exits 9 having done all its work correctly. A script that fails
// loudly on success is worse than one that spawns.
//
// dotenv does not overwrite a variable that is already set, so the rewritten
// URL below survives the child's own `import "../env"`.
execFileSync("npx", ["tsx", "drizzle/seed/index.ts"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL_UNPOOLED: url.toString(),
    DATABASE_URL: url.toString(),
  },
});

console.log(`\nDone. Students are never seeded — they arrive from a real`);
console.log(`export through /students/import or scripts/import-fees-bundle.ts.`);
