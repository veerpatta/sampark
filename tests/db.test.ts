import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The database module must be importable without a connection string.
 *
 * `next build` imports every route module to collect page data. When lib/db.ts
 * threw at module-evaluation time on a missing DATABASE_URL, that turned an
 * absent runtime secret into a failed BUILD, reported as:
 *
 *     Error: Failed to collect page data for /api/auth/[...nextauth]
 *
 * which names neither the variable nor the cause. It took out a production
 * deploy. Nothing in this app renders at build time, so the build has no
 * business needing database credentials — the client connects lazily instead.
 *
 * Runs in a child process with the variable stripped, because this process has
 * already loaded .env.local via the other test files. The probe goes in a temp
 * file rather than `node -e`: on Windows a shell-quoted inline script loses its
 * double quotes and fails to parse.
 */
describe("lib/db", () => {
  test("imports cleanly with no DATABASE_URL, and fails only on use", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_UNPOOLED;

    const dir = mkdtempSync(join(tmpdir(), "sampark-db-"));
    const probe = join(dir, "probe.mjs");
    const target = pathToFileURL(resolve("src/lib/db.ts")).href;

    writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(target)});`,
        `if (!m.db) throw new Error("db export missing");`,
        `console.log("IMPORT_OK");`,
        `try {`,
        `  await m.db.select().from(m.schema.students).limit(1);`,
        `  console.log("QUERY_UNEXPECTEDLY_SUCCEEDED");`,
        `} catch (error) {`,
        `  console.log("QUERY_THREW:" + error.message.slice(0, 40));`,
        `}`,
      ].join("\n"),
      "utf8",
    );

    try {
      const out = execFileSync("node", ["--import", "tsx", probe], {
        env,
        encoding: "utf8",
        cwd: process.cwd(),
      });

      assert.match(out, /IMPORT_OK/, "importing must not throw");
      assert.match(
        out,
        /QUERY_THREW:DATABASE_URL is not set/,
        "using it without a URL must still fail, and name the variable",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
