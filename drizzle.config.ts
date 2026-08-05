import "./drizzle/env";
import { defineConfig } from "drizzle-kit";

/**
 * Migrations run against the UNPOOLED (direct) Neon connection as the project
 * owner role. The application itself connects through the pooled URL as
 * `app_rw`, which has no DDL rights. See SAMPARK_BUILD_PLAN.md section 4.2.
 */
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set to run drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
});
