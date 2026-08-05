import "../drizzle/env";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Create the `app_rw` role and apply drizzle/sql/grants.sql.
 *
 *   npm run db:grants
 *
 * Run this once after the first migration, and again after every later
 * migration — grants.sql deliberately does not use ALTER DEFAULT PRIVILEGES,
 * so a new table has no app_rw grants until this runs. See the comment at the
 * top of that file for why that tradeoff is the right way round.
 *
 * Connects as the Neon owner over the UNPOOLED connection, because creating a
 * role and granting privileges are both DDL and app_rw has no DDL rights.
 *
 * THE PASSWORD NEVER TOUCHES THE REPO. It is generated here, written to
 * .env.local (gitignored), and read back on subsequent runs so re-running does
 * not rotate a credential Vercel is already using.
 */
const ENV_FILE = ".env.local";
const ROLE = "app_rw";

async function main() {
  const base = process.env.DATABASE_URL_UNPOOLED;
  if (!base) {
    throw new Error(
      "DATABASE_URL_UNPOOLED must be set — grants run as the Neon owner role.",
    );
  }

  /**
   * Optional Neon compute id, to grant on a branch other than the default:
   *
   *   npm run db:grants -- ep-summer-art-azhmd10t
   *
   * Roles and grants are PER BRANCH. A branch created before app_rw existed
   * does not have it, and a preview deployment pointed at that branch will
   * fail to authenticate rather than fail to find a table — which looks like a
   * completely different problem.
   */
  const endpoint = process.argv[2];
  if (endpoint && !/^ep-[a-z0-9-]+$/.test(endpoint)) {
    throw new Error("That does not look like a Neon compute id (ep-...).");
  }

  const ownerUrl = endpoint
    ? withEndpoint(base, endpoint)
    : base;

  const password = readOrCreatePassword();
  const sql = neon(ownerUrl);

  // CREATE ROLE has no IF NOT EXISTS, so branch on the catalog. ALTER on the
  // second run keeps the password in step with .env.local without rotating it.
  const [existing] = await sql`
    SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}
  `;

  // sql.query() rather than the template tag: a role name and a GRANT target
  // cannot be a bind parameter, so these are literal statement text.
  if (existing) {
    await sql.query(
      `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${escape(password)}'`,
    );
    console.log(`role ${ROLE} already existed — password re-applied`);
  } else {
    await sql.query(
      `CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${escape(password)}'`,
    );
    console.log(`created role ${ROLE}`);
  }

  for (const statement of splitStatements(
    readFileSync("drizzle/sql/grants.sql", "utf8"),
  )) {
    await sql.query(statement);
  }
  console.log("applied drizzle/sql/grants.sql");

  // Only rewrite .env.local when granting on the branch it already points at.
  // Doing it for a side branch would silently repoint local development at the
  // wrong database.
  if (endpoint) {
    console.log(`granted on branch endpoint ${endpoint} — .env.local untouched`);
  } else {
    writeAppUrl(ownerUrl, password);
  }
  await report(sql);
}

/** Swap the endpoint id in a Neon URL, leaving credentials and region alone. */
function withEndpoint(url: string, endpoint: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(/^ep-[^.]+/, endpoint);
  return parsed.toString();
}

/**
 * The generated password is url-safe on purpose: it goes straight into a
 * connection string, and a '/' or '+' there needs escaping nobody remembers.
 */
function readOrCreatePassword(): string {
  const fromEnv = process.env.APP_RW_PASSWORD;
  if (fromEnv) return fromEnv;

  const password = randomBytes(24).toString("base64url");
  appendEnv(`APP_RW_PASSWORD=${password}`);
  console.log(`generated a new ${ROLE} password and wrote it to ${ENV_FILE}`);
  return password;
}

/**
 * Point the app at app_rw over the POOLED connection, leaving
 * DATABASE_URL_UNPOOLED as the owner for drizzle-kit and the seed. This is the
 * split drizzle.config.ts already documents.
 */
function writeAppUrl(ownerUrl: string, password: string) {
  const owner = new URL(ownerUrl);
  const appUrl = new URL(ownerUrl);
  appUrl.username = ROLE;
  appUrl.password = password;
  // The unpooled host carries no -pooler segment; the app wants the pooled one.
  appUrl.hostname = owner.hostname.includes("-pooler")
    ? owner.hostname
    : owner.hostname.replace(/^(ep-[^.]+)\./, "$1-pooler.");

  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith("DATABASE_URL="));
  const next = `DATABASE_URL=${appUrl.toString()}`;

  if (index === -1) {
    appendEnv(next);
  } else if (lines[index] !== next) {
    lines[index] = next;
    writeFileSync(ENV_FILE, lines.join("\n"), "utf8");
  }
  console.log(`DATABASE_URL in ${ENV_FILE} now connects as ${ROLE}`);
  console.log(
    `set the same value in Vercel — the deployment still connects as the owner until you do`,
  );
}

function appendEnv(line: string) {
  const current = readFileSync(ENV_FILE, "utf8");
  const separator = current.endsWith("\n") ? "" : "\n";
  writeFileSync(ENV_FILE, `${current}${separator}${line}\n`, "utf8");
}

/**
 * grants.sql is ours: no dollar-quoting, no semicolons inside literals. Strip
 * line comments, then split on semicolons. Enough for this one file, and it
 * avoids pulling in a SQL parser to run nine statements.
 */
function splitStatements(source: string): string[] {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const escape = (value: string) => value.replace(/'/g, "''");

/** Print what the database actually granted, not what we asked it to grant. */
async function report(sql: NeonQueryFunction<false, false>) {
  const rows = (await sql`
    SELECT table_name, privilege_type, column_name
    FROM information_schema.column_privileges
    WHERE grantee = ${ROLE} AND table_name IN ('submissions', 'change_log')
      AND privilege_type IN ('UPDATE', 'DELETE')
    ORDER BY table_name, privilege_type, column_name
  `) as { table_name: string; privilege_type: string; column_name: string }[];

  console.log("\nwritable columns on the append-only tables:");
  if (rows.length === 0) {
    console.log("  (none)");
  }
  for (const row of rows) {
    console.log(
      `  ${row.table_name}.${row.column_name} — ${row.privilege_type}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
