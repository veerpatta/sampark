import "../drizzle/env";
import { execFileSync } from "node:child_process";

/**
 * Apply migrations to a Neon branch other than the one .env.local points at.
 *
 *   npm run db:migrate:branch -- ep-summer-art-azhmd10t
 *
 * The project has more than one branch — `production`, which the app and
 * drizzle.config.ts use, and `vercel-dev`, which the Vercel integration points
 * preview and development deployments at. Running `npm run db:migrate` only
 * ever touches the first one, so the second silently drifts until a preview
 * deploy falls over with "relation does not exist".
 *
 * Takes only the compute id and rewrites the host of the existing owner
 * connection string, so no second credential has to be stored or pasted. The
 * URL is never printed.
 */
const endpoint = process.argv[2];
if (!endpoint) {
  console.error(
    "Usage: npm run db:migrate:branch -- <compute-id>\n" +
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
  throw new Error("DATABASE_URL_UNPOOLED must be set — migrations run as owner.");
}

const url = new URL(owner);
// Swap only the endpoint id; region, project suffix and credentials all stay.
url.hostname = url.hostname.replace(/^ep-[^.]+/, endpoint);

console.log(`Applying migrations to ${endpoint} …`);

execFileSync("npx", ["drizzle-kit", "migrate"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL_UNPOOLED: url.toString(),
    DATABASE_URL: url.toString(),
  },
});

console.log(`\nDone. Remember to apply grants to this branch too:`);
console.log(`  the app_rw role and drizzle/sql/grants.sql are per-branch.`);
