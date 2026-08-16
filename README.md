# Sampark — VPPS Data Desk

Internal student-data collection tool for **Shri Veer Patta Senior Secondary
School, Amet (Rajsamand, Rajasthan)**.

It solves one problem: collecting and updating student data from teachers who
only use mobile phones and are not technical.

The core mechanic is **verify, don't enter**. The school already holds most of
the data, so instead of asking a teacher to produce it, we send them what we
have and ask them to confirm or correct it. A class teacher checking 40 mobile
numbers is 40 taps and maybe 3 corrections — five minutes. Typing 40 mobile
numbers is a forty-minute job nobody does.

The full specification lives in **[SAMPARK_BUILD_PLAN.md](./SAMPARK_BUILD_PLAN.md)**.
Read it before changing anything here. If you are handing this to an AI coding
agent, start from **[PROMPTS.md](./PROMPTS.md)**.

---

## Non-negotiables

- **No login for teachers.** A tokenised link opened from WhatsApp is the entire
  onboarding.
- **Scoped links.** A request link opens exactly one group and exactly the fields
  requested.
- **Nothing overwrites master silently.** Every submission is a *proposed*
  change in a review queue.
- **Student ID is the key.** Never match by name.
- **Validate at entry.** A 9-digit phone number must be impossible to submit.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Database | Neon Postgres |
| DB access | `@neondatabase/serverless` + Drizzle ORM |
| Styling | Tailwind CSS v4 + token layer (`src/styles/tokens.css`) |
| Admin auth | Auth.js v5, Credentials provider |
| Teacher auth | Token in URL + optional 4-digit PIN |
| Excel / CSV | ExcelJS / PapaParse |
| Student photos | Vercel Blob, private store, read through a session-checked proxy |
| Hosting | Vercel |

**The browser never connects to the database.** Neon has no anonymous API
surface and no RLS we can lean on, so every read and write goes through a
Next.js server route and authorization lives in exactly one place:
`src/lib/auth/token.ts`.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the Neon and Auth.js values
npm run dev
```

Open <http://localhost:3000>.

### Database

```bash
npm run db:generate     # generate a migration from drizzle/schema.ts
npm run db:migrate      # apply it (uses DATABASE_URL_UNPOOLED, owner role)
npm run db:grants       # create app_rw and apply drizzle/sql/grants.sql
npm run db:seed         # field registry (idempotent)
npm run db:create-user  # create or reset an admin console account
npm run db:studio       # browse the data
npm run icons           # regenerate the PWA icons from public/icon.svg
```

#### More than one Neon branch

The project has two: `production` (what the app and `drizzle-kit` use) and
`vercel-dev` (what the Vercel integration points preview and development
deployments at). **Migrations, roles and grants are all per-branch** — running
`npm run db:migrate` only ever touches the first, and the second silently drifts
until a preview deploy fails with "relation does not exist".

```bash
npm run db:migrate:branch -- ep-summer-art-azhmd10t   # vercel-dev
npm run db:grants -- ep-summer-art-azhmd10t
npm run db:seed:branch -- ep-summer-art-azhmd10t
```

All three take a Neon compute id and rewrite only the host of the existing owner
connection string, so there is no second credential to store. None prints the
URL, and granting on a side branch deliberately leaves `.env.local` alone.

Schema, roles, grants **and seed data** are all per-branch. `vercel-dev` sat with
every migration applied and an empty `field_defs` for a while, which does not
fail at deploy — it fails later, on the first screen that reads the registry.
Both branches now carry the registry; `db:seed:branch` is what keeps it that way.

**Re-run `db:grants` after every migration.** It deliberately does not use
`ALTER DEFAULT PRIVILEGES`, because blanket defaults would silently hand `app_rw`
full UPDATE and DELETE on any table a later migration creates — including a
recreated `submissions`. Re-running one command is cheap; a quietly writable
audit log is not.

Migrations run as the Neon owner role. The application runs as `app_rw`, which
has no DDL rights and cannot UPDATE or DELETE the append-only tables — the only
writable column on either of them is `submissions.review_status`. See section 4.2
of the build plan for the exact grants.

#### Refreshing the master record from the fee app

The fee app exports a fourteen-sheet context bundle. `scripts/import-fees-bundle.ts`
reads its `Students` sheet as the `fees` source, so precedence decides what it
may touch — it will not undo an approved teacher correction, and PSP keeps the
identity fields it owns.

```bash
npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx                      # dry run
npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx --apply
npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx --apply --remove-missing
```

Rows match on **SR number**. The bundle's `Student ID` column is the fee app's
own UUID and is deliberately not mapped — it collides with nothing in
`students.id`, so mapping it across (which the `/students/import` auto-mapper
will suggest, because of the header spelling) turns a refresh into 531 duplicate
children. Prefer this script over the upload screen for a whole bundle.

`--remove-missing` **deletes** students who are no longer in the bundle, along
with their roster entries and submissions. It needs `DATABASE_URL_UNPOOLED`,
because `submissions` and `change_log` are append-only for the app role — that
credential requirement is the guard rail, not an obstacle to route around. Every
deleted row is dumped to `private/archive/` first.

Teachers and admin users are **never** seeded from a file. The repo is public and
both carry personal data, so teachers are entered at `/settings/teachers` and
accounts are created interactively with `npm run db:create-user`.

### The test school

```bash
npm run db:seed:test
```

A small fake school for driving the console: four teachers, 79 invented
children across classes 7–10, subject assignments, an owner account, and three
live rounds — one marks round part-entered, one nobody has touched, and one
phone round waiting in `/review`. It is idempotent, so re-running refreshes it.

Nothing in it is real, and it **refuses to run** against a database holding any
student or teacher that is not one of its own fixtures. There is deliberately no
flag to override that: it invents children, and the one thing standing between a
fixture run and the school's own data should not be something you can type past.

The account is `test.owner@sampark.invalid`. Its email is in the repo so its
password is not — set `TEST_LOGIN_PASSWORD` in `.env.local` and re-run the seed
to be able to sign in by hand. Without it the account exists but cannot be
logged into, which is the right default.

### Tests

```bash
npm test
```

Node's built-in test runner (`node --test`) via `tsx`, so there is no test
framework dependency to keep current. Coverage is deliberately narrow and aimed
at the two places the build plan calls out as expensive to get wrong: the token
resolver and the import matching rules.

### The smoke test

```bash
npm run dev      # in another terminal
npm run smoke
```

`npm test` runs with no server and no blob store, so the route handlers are the
one layer it cannot reach — and that is where the rate limiter, the frozen-roster
check and the JPEG sniff actually live. `npm run smoke` drives a whole photo
round over HTTP exactly as a teacher's phone does: it creates a request, uploads
a real JPEG, refuses a PNG wearing a JPEG content-type, refuses a child off the
roster, reads the photo back, submits the pathname as an ordinary field value,
refuses one child's photo on another child, approves it into the master record,
and checks the change log.

It also asserts the two things that are invisible until they are wrong:

- **the blob store is PRIVATE** — it fetches the raw blob URL with no
  credentials and requires a refusal. A public store behaves identically from
  inside the app and differs only in that every photograph of every child is
  readable by anyone who ever sees a URL.
- **a request holding answers cannot be deleted** by the app role, which is the
  reason `removeRequest` archives rather than deletes.

Everything it creates is prefixed `ZZTESTSMOKE`, including the blobs, and is torn
down at the end. Point it elsewhere with `SMOKE_BASE_URL`.

### The UI smoke test

```bash
npm run db:seed:test   # once
npm run dev            # in another terminal
npm run smoke:ui
```

`npm run smoke` has no session and says so, which left every screen behind
`requireUser()` uncovered — the boards, the exports, the settings pages. This
walks all fourteen of them signed in, plus a whole marks round through the
teacher's own link: submit, straight into `student_records`, onto `/marks`, out
as a workbook, with nobody approving anything. It also checks the other half of
that: a phone correction still queues for review.

It signs in by **minting a session** (`npm run test:session`) rather than by
driving the login form. A session is a signed JWT and `AUTH_SECRET` already
signs it, so nothing new is secret and no password has to exist anywhere a
script can read it. It is not a bypass — the server validates the cookie exactly
as it validates a real one, and `currentUser()` still re-reads the row, so a
cookie naming a user who is not seeded resolves to nobody.

`npm run test:session` also prints a one-liner for pasting into a browser
console, which is how you get a logged-in browser without a password.

The round it creates is torn down at the end; the fixture school stays.

---

## Layout

```
drizzle/
  schema.ts             all nine tables, transcribed from plan section 4
  migrations/           generated by drizzle-kit
  sql/grants.sql        append-only enforcement (plan 4.2); drops the dead
                        request_progress view — see the note in the file
  seed/                 field registry — and test-school.ts, which is all invented
scripts/
  db-grants.ts          creates app_rw, applies grants.sql
  migrate-branch.ts     migrations for a non-default Neon branch
  seed-branch.ts        field registry for a non-default Neon branch
  import-fees-bundle.ts master refresh from a fee-app context bundle
  create-user.ts        interactive admin account creation
  smoke.ts              a whole photo round over HTTP — see above
  make-icons.ts         PWA icons, rasterised from icon.svg
  backup.ps1            verified weekly pg_dump
tests/                  node:test, run with `npm test`
src/
  app/
    (admin)/            admin console — the layout is the auth gate
    r/[token]/          the teacher surface — no shell, no navigation
    login/
    api/
  components/
  lib/
    db.ts               the single database entry point
    auth/token.ts       THE one place teacher authorization lives
    auth/session.ts     Auth.js wiring + roles: owner | admin | office
    fields.ts           field registry validators (shared client + server)
    students.ts         master-record reads
    students-import.ts  match / diff / preview / apply
    student-columns.ts  field_defs.target_column -> Drizzle property name
    submissions.ts      action derivation + THE review transaction
    requests.ts         request creation and the frozen roster snapshot
    classes.ts          class-label normalising and ordering
    templates.ts        saved field sets for the request builder
    excel.ts            CSV + XLSX reading; export lands in Phase 4
    ratelimit.ts        30/min per token, 100/hr per IP
    whatsapp.ts         Hindi message templates
  styles/tokens.css
```

---

## Infrastructure

| Piece | Where | Notes |
|---|---|---|
| Repo | `github.com/veerpatta/sampark` | **Public.** No secret may ever be committed. |
| Hosting | Vercel · `veerpattas-projects/sampark` | Auto-deploys `main` to production |
| Database | Neon · `aws-ap-southeast-1` (Singapore) | Nearest available region — Neon has no Mumbai |

Vercel environment variables (Production / Preview / Development):

| Variable | Prod | Preview | Dev |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | ✅ |
| `DATABASE_URL_UNPOOLED` | ✅ | — | ✅ |
| `AUTH_SECRET` | ✅ | ✅ | local only |
| `AUTH_URL` | ✅ | — | local only |
| `ACADEMIC_YEAR` | ✅ | ✅ | ✅ |

`DATABASE_URL_UNPOOLED` is deliberately absent from Preview. It is the direct
owner-role connection used only by `drizzle-kit` for migrations, and migrations
never run from a preview deployment — a preview build has no business holding a
credential with DDL rights.

`AUTH_URL` is unset for Preview because preview hostnames change per deployment;
Auth.js infers the host there.

**There is no `APP_TIMEZONE`, and adding one back would be a regression.** It was
listed here and in `.env.example` for a long time and read by nothing. The
school's zone is a constant in `src/lib/today.ts` because three of its callers
are client components: a client cannot read a server-only variable, so the
failure mode is not a missing-config error but a silent fall back to a different
zone on one side of the network — which is precisely the bug that file exists to
fix. **It may still be set in the Vercel project; it can be deleted there.** A
second school in a second zone belongs on the school record, not the environment.

---

## Build status

| Phase | Scope | Status |
|---|---|---|
| 0 | Skeleton, schema, config | **done** |
| 1 | Migrations, grants, seed, admin auth, student import, `/students` | **done** |
| 2 | Request builder, token, roster snapshot, read-only `/r/[token]` | **done** |
| 3 | Teacher submit flow, `/review` approval transaction | **done** |
| 4 | Excel export, WhatsApp reminders | **partial** — FA marks layout blocked |
| — | `/students/[id]`, `/settings/users`, per-request export | **done** |
| 5 | Offline drafts, submit queue, PWA | **done** |
| 6 | Rate limiting, close/reopen, registry editor, audit | **done** |

Phase 4 is blocked on one file: the FA marks export has to reproduce
`FA_Marks_Pattern.xlsx` exactly, and that cannot be written from a description —
a near-miss means someone redoes it by hand in Excel, which is the entire
problem it exists to remove. The students export and the reminder builder are
done.

### The PIN was removed

Plan section 5 offers an optional 4-digit PIN on `/r/*`. It was removed on
request, so a link is now a pure bearer token. The plan's threat model already
accepted forwarding as proportionate — the same teacher carries a paper register
with the same data — and what remains is the short expiry, the three-day grace
cut-off, **close/reopen**, and the fact that a request link reaches only one
group. Closing a request is now the fastest way to kill a link that has gone
somewhere it should not. Worth revisiting before an Aadhaar collection round.

### The durable teacher link

`/t/<token>` is a page listing whatever is currently open for one teacher. It
exists so a marks round costs no WhatsApp messages at all: she saves the link
once and the next round simply appears on it.

It is the one place a token reaches more than one group, so:

- **Revocation is nulling the column.** There is no `revoked_at` — a second
  column somebody has to remember to check is a link that outlives its own kill
  switch. Rotating overwrites it in the same UPDATE, so the old URL dies the
  instant the new one is born.
- **Revoke-all in Settings → Teachers is the global switch**, not an
  environment variable: env changes need a redeploy, and a kill switch whose
  latency is a build is not one. Afterwards, sends fall back to the grouped
  queue — one message per teacher — which is why that path is never removed.
- **`NEVER_ON_TEACHER_PAGE`** in `lib/auth/token.ts` keeps Aadhaar, Jan Aadhaar
  and date-of-birth rounds off every durable page. Nothing to remember and
  nothing to tick.
- **The service worker deliberately does not cache `/t/`.** A cached copy would
  survive revocation and keep handing out working request links from disk.

### Backups

Neon point-in-time restore covers "someone approved the wrong thing an hour
ago". Note that **history retention on this project is 6 hours** — check the
Neon console if you want longer, it is a paid-tier setting. The `production`
branch is also **not** marked protected.

`scripts/backup.ps1` writes a verified `pg_dump` to a directory outside the
repo, for the case PITR cannot cover: losing the Neon project itself. Run it
weekly. **The dump contains every student's name, phone number and Aadhaar
number** — keep it off shared drives.

Each phase must work end to end before the next one starts.

---

## Open decisions

Tracked in section 13 of the build plan.

**Settled:** the class label convention is `12 Sci` — class number, then a short
stream suffix where one is needed (`6`, `10 A`, `12 Sci`). Every path that
accepts a label normalises through `src/lib/classes.ts`, because request
creation filters the roster on `students.class_label` and a label differing by
one space produces an empty roster with no error.

**Still open, and what each one blocks:**

1. Final field list for `field_defs` — the seeded fourteen are the plan's
   starting set; the bus-route option list is still empty
2. A real PSP export to pin the import column mapping against. The auto-mapper
   guesses from common header spellings and every column is confirmed by hand
   before anything is written, so this is not a blocker — but a real file would
   turn guesses into knowledge
3. Max marks per FA subject — 25 is assumed and unconfirmed against LEAD
4. Whether `office` can approve into master. Currently `office` can create
   requests but cannot import or approve; loosening it is a one-line change in
   `src/lib/auth/session.ts`

---

*Document owner: Janmejay · Shri Veer Patta Senior Secondary School, Amet*
