import "../drizzle/env";
import { encode } from "next-auth/jwt";
import { SESSION_MAX_AGE_SECONDS } from "../src/lib/auth/session";
import { TEST_USER } from "../drizzle/seed/test-school";

/**
 * A signed session cookie for the test account, without a password.
 *
 *   npm run test:session          # prints the cookie, for pasting into a browser
 *
 * WHY MINT RATHER THAN SIGN IN. scripts/smoke.ts says in as many words that it
 * cannot reach anything behind requireUser(), so the entire admin console —
 * every board, every export, every settings screen — has never been covered by
 * it. Driving the login form instead would mean a password for a public-repo
 * account existing somewhere a script can read it, which is the one thing
 * create-user.ts is written to prevent.
 *
 * A session is a signed JWT, and the secret that signs it is already in
 * .env.local. So the honest answer is to mint one: nothing new is secret, no
 * password exists to leak, and the check works in CI where no human can type.
 *
 * THIS IS NOT A BACK DOOR INTO THE APPLICATION. It proves nothing the signing
 * secret does not already prove — anyone holding AUTH_SECRET can already mint
 * any session, which is what a signing secret means. There is no new endpoint,
 * no dev-only bypass in the app, and nothing here ships: it is a script, and the
 * server it talks to validates the cookie exactly as it validates a real one.
 *
 * And the session alone is not enough to BE anyone. currentUser() re-reads the
 * row on every guarded call and takes the role from the database, so a cookie
 * naming a user who does not exist, or who is inactive, resolves to nobody. The
 * fixture user has to be seeded for this to work at all.
 */

/** Auth.js v5 over http. TLS would make it __Secure-authjs.session-token. */
export const SESSION_COOKIE = "authjs.session-token";

export async function mintSessionCookie(userId = TEST_USER.id): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set — it is what signs the session, so there is " +
        "nothing to mint with. Copy it from .env.local.",
    );
  }

  // `uid` is what the session callback reads (lib/auth/session.ts); `sub` is
  // what Auth.js expects any JWT it issued to carry. The role is deliberately
  // absent: it is re-read from the database, so putting one here would only
  // create a second answer to a question that already has one.
  const token = await encode({
    token: { uid: userId, sub: userId },
    secret,
    salt: SESSION_COOKIE,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return `${SESSION_COOKIE}=${token}`;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/test-session.ts")) {
  mintSessionCookie()
    .then((cookie) => {
      console.log(`\nCookie for ${TEST_USER.email}, valid 8 hours:\n`);
      console.log(cookie);
      console.log(
        `\nIn a browser on http://localhost:3000, paste into the console:\n` +
          `  document.cookie = ${JSON.stringify(`${cookie}; path=/`)}\n` +
          `then reload. Seed the fixtures first: npm run db:seed:test\n`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
