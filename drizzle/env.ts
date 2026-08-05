import { config } from "dotenv";

/**
 * Next.js reads `.env.local` automatically; plain Node scripts (drizzle-kit,
 * the seed) do not. Load the same files, in the same precedence order, so a
 * migration and the running app can never disagree about which database they
 * are pointed at.
 *
 * Earlier entries win — dotenv does not overwrite an already-set variable.
 */
config({ path: [".env.local", ".env"], quiet: true });
