# Claude Code kickoff prompt

> **This is a historical log, not a current briefing.** It was written on
> 2026-08-05, when Phase 0 was the whole of the repo and the database was empty.
> Everything it calls upcoming has shipped. It is kept, with `PROMPTS-2` through
> `-6`, because the six form a chain that corrects itself — 3 reverses part of 2,
> 4 corrects 3, 5 reconciles 3 against 4 — and that chain only reads if each one
> stays as it was written.
>
> **For where the project actually stands, read the README's Build status.**

Paste the block below into Claude Code from the repo root. It orients the agent
on the plan, the current state of the repo, and the mistakes that are expensive
in this particular codebase.

This supersedes section 14 of `SAMPARK_BUILD_PLAN.md`, whose per-phase prompts
were written before the Phase 0 scaffold existed and now describe work that is
already done.

---

```
You are building Sampark — an internal student-data tool for Shri Veer Patta
Senior Secondary School, Amet, Rajsamand, Rajasthan.

Read SAMPARK_BUILD_PLAN.md in full before writing any code. It is the
specification, not background reading. Read README.md too — it records what is
actually deployed. When this prompt and the plan disagree, the plan wins; tell
me about the conflict rather than silently picking one.

## What the product is

Teachers at this school use cheap phones and are not technical. The tool solves
exactly one problem: keeping student data current without asking them to type.

The mechanic is "verify, don't enter". The school already holds most of the
data, so we send a teacher what we have and ask her to confirm or correct it.
Checking 40 mobile numbers is 40 taps and maybe 3 corrections — five minutes.
Typing 40 mobile numbers is a forty-minute job nobody does. Every design
decision follows from that sentence. If a choice makes the teacher's phone
screen slower or more confusing in exchange for elegance anywhere else, it is
the wrong choice.

## Where the project stands

Phase 0 is complete and deployed. Before writing anything, read what already
exists so you extend it instead of duplicating it:

- drizzle/schema.ts — all nine tables from plan section 4, with types exported
- drizzle/seed/ — field_defs (the 14 starting fields), teachers (empty
  placeholder), and an idempotent seed runner
- src/lib/db.ts — the single database entry point
- src/lib/auth/token.ts — token generation and the expiry/PIN predicate
- src/lib/auth/session.ts — the owner/admin/office role predicates
- src/lib/fields.ts — registry validators, shared client and server
- src/lib/ratelimit.ts, whatsapp.ts, excel.ts — real code and marked TODOs
- src/app/(admin)/ — route shells rendering explicit "not built yet" stubs
- src/app/r/[token]/ — fail-closed 404 until Phase 2
- next.config.ts — the /r/* security headers, already verified in production

No migration has been generated yet and the database is empty.

## How to work

Follow plan section 8. Work one phase at a time, in order, starting with
Phase 1. Do not start a phase until the previous one works end to end — a
half-finished Phase 2 on top of an unproven Phase 1 is how this project dies.

At the end of each phase, tell me plainly: what works, what you did not build,
and what you are unsure about. Do not report a phase as done when a piece is
stubbed. An honest "the import dry-run works but I have not tested XLSX, only
CSV" is worth far more to me than a green checkmark.

Prefer boring, readable code. This is a school tool with a maintenance budget of
one person's evenings — not a place for clever abstractions.

## Rules that are expensive to break

These are the ones I will be checking. Most come straight from the plan; they
are collected here because each has already been thought about and settled.

1. The browser NEVER connects to the database. Neon has no anonymous API
   surface and no row-level security. Every read and write goes through a
   server route, and all teacher-facing authorization lives in exactly one
   place: src/lib/auth/token.ts. Do not add a second place.

2. Teachers never have an account, a password, or a login screen. The token in
   the URL is the entire onboarding. A link opens exactly one class and exactly
   the fields requested — no menu, no navigation, no way to reach another class.

3. Every teacher submission is a PROPOSED change. Nothing reaches the students
   table without an explicit approval that carries a user id and a timestamp.

4. submissions and change_log are append-only, enforced by database grants (plan
   section 4.2), not by application discipline. The app role gets INSERT and
   SELECT, plus UPDATE on submissions.review_status alone.

5. The approval path is one transaction, and the UPDATE guards on
   review_status = 'pending'. That guard is what makes a double-approval a
   no-op. Do not drop it for readability.

6. request_students.snapshot is frozen at send time and is never recomputed.
   The review screen's "old value" must be what the teacher actually saw, even
   if master data moved in between.

7. Import matches on student ID first, then SR number, NEVER on name. A blank
   cell means "no change", never "erase". A missing SR number is a warning, not
   a blocker. A row with only name + class is valid.

8. Validate from the field registry on the client for instant feedback, then
   re-validate identically on the server. The client is never trusted. Keep the
   two paths as one shared module so they cannot drift.

9. Every rejection on /r/[token] — unknown token, expired, closed, wrong PIN —
   renders an identical 404. Never leak which one it was.

10. The teacher UI is Hindi-first with the three actions सही है / बदलें /
    नहीं है. The admin console is English. Touch targets are at least 48px and
    inputs are at least 16px so iOS does not zoom on focus.

11. Adding a collectable field must stay a database row, not a deployment. If
    you find yourself hardcoding a field key in a component, stop.

12. THE REPO IS PUBLIC. No connection string, secret, API key, real student
    name, phone number, or Aadhaar number in any committed file — including
    tests, fixtures, and seed data. Read .env.local for local values; it is
    gitignored and must stay that way.

## Verifying your work

Before you tell me a phase is done, all of these must pass, and I would rather
you run them yourself than ask me to:

    npx tsc --noEmit
    npx eslint .
    npm run build

The database is live and reachable. npm run db:generate writes a migration,
npm run db:migrate applies it via the unpooled owner connection, and
npm run db:seed is idempotent and safe to re-run.

Plan section 6 says the token resolver and the review transaction are where a
bug is expensive. Write tests for those two when you touch them, even though
the plan formally schedules tests in Phase 6. There is no test runner installed
yet — add one and tell me what you picked and why.

## Environment facts that will otherwise waste your time

- Windows, PowerShell. `&&` is not a statement separator; use `;`.
- NODE_ENV=production is set globally on this machine, so a bare `npm install`
  silently skips every devDependency. Use `npm install --include=dev`.
- Secrets live in .env.local. Next.js reads it automatically; plain Node
  scripts do not, which is why drizzle.config.ts and the seed both import
  ./drizzle/env first. Follow that pattern for any new script.
- Neon is in aws-ap-southeast-1 (Singapore). Neon has no Mumbai region and a
  project's region cannot be changed after creation. This is settled — do not
  suggest moving it.
- Vercel auto-deploys main to production. A push is a deploy.

## Where to stop and ask me

Plan section 13 lists open decisions. Several of them block Phase 1, and I
would rather answer a question than unpick an invented convention later. Ask,
do not guess, when you need:

- the final field list for the field_defs seed
- the class label convention ('12 Sci' vs '12-A Science' vs stream as its own
  column) — this must match students.class_label exactly and is painful to
  change once data is loaded
- a real PSP export to pin the import column mapping against
- whether the office role can approve into master
- the max marks per FA subject (25 is assumed, unconfirmed against LEAD)

Also stop and ask before: installing a dependency the plan does not name,
changing the schema in drizzle/schema.ts, or doing anything that writes to a
table other than through the approval path.

Start by reading the plan and the existing source, then tell me your plan for
Phase 1 before you write code.
```

---

## Per-phase follow-ups

Once Phase 1 works end to end, the follow-up is short — the kickoff prompt has
already established the rules:

```
Phase 1 works. Read SAMPARK_BUILD_PLAN.md section 8 Phase 2 and build it,
following the same rules as before. Tell me your plan first.
```

## Optional: make the standing rules permanent

The "rules that are expensive to break" and "environment facts" sections are
worth moving into a `CLAUDE.md` at the repo root. Claude Code reads that file
automatically on every session, so the rules survive context compaction and you
stop re-pasting them.
