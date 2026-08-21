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
- **Nothing overwrites master silently.** A correction to master data — anything
  with a `target_column` — is a *proposed* change in a review queue, never a
  write. Marks and one-off questions are not master data and land directly; see
  [Two destinations](#two-destinations-and-only-one-of-them-is-reviewed).
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
| Teacher auth | Token in URL. No PIN — see [The PIN was removed](#the-pin-was-removed) |
| Validation | Zod |
| Icons | Phosphor |
| Excel / CSV | ExcelJS / PapaParse |
| Student photos | Vercel Blob, private store, read through a session-checked proxy |
| Hosting | Vercel |

**The browser never connects to the database.** Neon has no anonymous API
surface and no RLS we can lean on, so every read and write goes through the
server. **Teacher** authorization lives in exactly one place —
`src/lib/auth/token.ts` — which is the rule that matters, because that surface has
no login to fall back on. Admin authorization is `src/lib/auth/session.ts`
(`requireUser`, `canApproveIntoMaster`, `canManageSettings`), with
`src/app/api/r/[token]/guard.ts` sharing the token checks across the two teacher
routes.

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
npm run db:seed         # field registry, precedence sources, teachers (idempotent)
npm run db:create-user  # create or reset an admin console account
npm run db:studio       # browse the data
npm run subjects:import # who teaches what, from the timetable
npm run icons           # regenerate the PWA icons from public/icon.svg
```

There is also `npm run db:push`. **Prefer `db:generate` + `db:migrate`.** `push`
diffs the schema straight onto the database with no migration file, so the branch
it is run against stops being reproducible from the repo — and the grants below
are keyed to migrations having run.

`npm run lint`, `npm run typecheck` and `npm run build` are the three that gate a
deploy; run them before pushing.

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

Teachers and admin users carry personal data and the repo is public, so
**`drizzle/seed/teachers.ts` ships empty and must stay that way.** Teachers are
entered at `/settings/teachers` and accounts are created interactively with
`npm run db:create-user`. The seed file exists only so a throwaway branch can be
populated locally without one.

### The test school

```bash
npm run db:seed:test
```

A small fake school for driving the console: four teachers, 78 invented children
across classes 7–10 in uneven sizes, subject assignments, an owner account, and
four live rounds — one marks round part-entered, one nobody has touched, one
phone round waiting in `/review`, and one send-to-many. It is idempotent, so
re-running refreshes it.

**Two of the four teachers are called Sunita Sharma**, deliberately. The marks
export keys on `teachers.id`, and a fixture school where every name is unique
cannot tell you whether it still does.

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
framework dependency to keep current. **552 tests across 41 files.**

It started narrow, at the two places the build plan calls expensive to get wrong
— the token resolver and the import matching rules — and grew to cover the shaping
functions generally, because that is where the bugs that matter live: a teacher's
marks landing on the wrong sheet, a subject column in the wrong place, a round
that says 46/46 on her phone and 40 of 46 on the board. Modules are written so
those functions are pure and can be tested without a database.

Two are worth knowing about by name:

- **`student-export.test.ts` is a drift guard, not a test of today's columns.** It
  walks the live Drizzle schema, so a new `students` column fails the suite until
  it is either given a workbook column or added to `DELIBERATELY_ABSENT` with a
  reason. It also re-checks the export → fix in Excel → re-import round trip.
- **`today.test.ts`** passes the instant in rather than waiting for 18:30 UTC,
  including the case that pins the old UTC rule and the new IST one disagreeing.

It needs `DATABASE_URL_UNPOOLED`: `tests/fixtures.ts` talks to a real database.
What it has no access to is a server and a blob store, which is what the smoke
tests below are for.

### The smoke test

```bash
npm run dev      # in another terminal
npm run smoke
```

`npm test` has a database but no server and no blob store, so the route handlers
are the one layer it cannot reach — and that is where the rate limiter, the frozen-roster
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

Not every file — the ones you need to find, and the ones whose names do not give
them away.

```
drizzle/
  schema.ts             the fifteen tables
  migrations/           generated by drizzle-kit
  sql/grants.sql        append-only enforcement (plan 4.2); drops the dead
                        request_progress view — see the note in the file
  seed/                 field registry, precedence sources, teachers (ships
                        empty) — and test-school.ts, which is all invented
scripts/
  db-grants.ts          creates app_rw, applies grants.sql
  migrate-branch.ts     migrations for a non-default Neon branch
  seed-branch.ts        field registry for a non-default Neon branch
  import-fees-bundle.ts master refresh from a fee-app context bundle
  import-psp.ts         PSP identity import — the fields PSP owns
  import-houses.ts      house allocation
  import-timetable-subjects.ts  who teaches what, from the timetable
  fix-teacher-classes.ts        one-off class-label repair
  create-user.ts        interactive admin account creation
  seed-test-school.ts   the invented school — see above
  smoke.ts              a whole photo round over HTTP — see above
  smoke-ui.ts           fourteen signed-in screens + a marks round
  test-session.ts       mints a session cookie, so no password has to exist
  make-icons.ts         PWA icons, rasterised from icon.svg
  backup.ps1            verified weekly pg_dump
tests/                  node:test, run with `npm test` — see above
src/
  app/
    (admin)/            admin console — the layout is the auth gate
                        page · requests/{new,bulk,batch/[id],[id]} · review
                        students/{[id],import} · marks
                        settings/{fields,teachers,subjects,users,audit}
    r/[token]/          the teacher form — no shell, no navigation
    t/[token]/          the durable teacher link — see below
    login/
    api/                requests · r/[token] (+ /photo) · photos
                        students/import · export/{students,marks}.xlsx
                        export/{request,batch}/[id] · auth
  components/           admin/ · teacher/ · ui/
  lib/
    db.ts               the single database entry point
    auth/token.ts       THE one place TEACHER authorization lives
    auth/session.ts     Auth.js wiring + roles: owner | admin | office
    fields.ts           field registry validators (shared client + server)
    field-keys.ts       key shapes: fa_* marks, q_* one-off questions
    students.ts         master-record reads
    students-import.ts  match / diff / preview / apply
    import-plan.ts      what an import may touch, given precedence
    precedence.ts       who wins when the third file disagrees
    student-columns.ts  field_defs.target_column -> Drizzle property name
    student-export.ts   the workbook's columns, derived from the live schema
    student-filters.ts  the query string IS the filter state; export honours it
    completeness.ts     twelve tracked fields -> a per-child score
    submissions.ts      action derivation, THE review transaction, and the
                        two destinations — read its header first
    requests.ts         request creation and the frozen roster snapshot
    request-origin.ts   absolute origin, so a link in WhatsApp is not relative
    answered.ts         THE one definition of "answered"
    progress.ts         per-teacher rollup for the board
    marks.ts            the marks board and its workbook
    batches.ts          send-to-many: one round, one row, one file
    fanout.ts           class/house/route -> groups, with an unassigned bucket
    send-queue.ts       one message per teacher, in order
    reminders.ts        one nudge per person, never one per link
    today.ts            THE school's calendar day (Asia/Kolkata), not the UTC one
    classes.ts          the nineteen labels: normalising, validating, ordering
    houses.ts routes.ts the four houses, the twenty-nine bus routes
    subjects.ts         the sixteen subjects the fa_* fields are generated from
    photos.ts           client-safe: key shapes and validation
    photo-store.ts      SERVER ONLY: reads blobs in bulk for the workbook
    templates.ts        saved field sets for the request builder
    excel.ts            CSV + XLSX read and write
    ratelimit.ts        four buckets, counted in Postgres — 30/min and 100/hr,
                        and 60/min + 500/hr for photos, which is why a class of
                        forty-six does not starve her own answer flushes
    whatsapp.ts         bilingual templates, English line over Hindi line
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
| `BLOB_READ_WRITE_TOKEN` | ✅ | ✅ | ✅ |

`BLOB_READ_WRITE_TOKEN` is read by the `@vercel/blob` SDK rather than by our code,
so it does not appear in a `process.env` grep — but **without it a photo round
cannot run at all**, and nothing else in the app needs it.

Three more are local or script-only and belong in `.env.local`, never in Vercel:
`APP_RW_PASSWORD` (created and appended by `npm run db:grants`),
`TEST_LOGIN_PASSWORD` (the fixture school's owner account) and `SMOKE_BASE_URL`
(points the smoke tests somewhere other than localhost).

`DATABASE_URL_UNPOOLED` is deliberately absent from Preview. It is the direct
owner-role connection used only by `drizzle-kit` for migrations, and migrations
never run from a preview deployment — a preview build has no business holding a
credential with DDL rights.

`AUTH_URL` is unset for Preview because preview hostnames change per deployment;
Auth.js infers the host there.

**There is no `APP_TIMEZONE`, and adding one back would be a regression.** It was
listed in both for a long time and read by nothing. The
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

**One file is blocking Phase 4, and it is not the marks export.** `/marks` and
`/api/export/marks.xlsx` shipped — the office's own per-teacher workbook for a
period, in this repo's ordinary shape. What is still blocked is LEAD's
`FA_Marks_Pattern.xlsx`, which has to be reproduced exactly and cannot be written
from a description: a near-miss means someone redoes it by hand in Excel, which is
the entire problem it exists to remove. It unblocks the day someone sends the file.
See the TODO at the foot of `src/lib/excel.ts`.

The phases were the v1 plan and the work has outgrown them. Also shipped, and
belonging to no phase:

| Scope | Status |
|---|---|
| Send-to-many: `/requests/bulk`, `/requests/batch/[id]`, batch export | **done** |
| Houses and bus routes as request audiences | **done** |
| Subjects, `teacher_subjects`, timetable import | **done** |
| The durable teacher link `/t/[token]` | **done** |
| Marks written at submit, `/marks` board, marks workbook | **done** |
| Per-teacher progress board | **done** |
| Source precedence (`sources`, `field_sources`, `value_sources`) | **done** |
| Autosave, offline photo queue, resumable teacher link | **done** |
| Student completeness scoring and filtering | **done** |

### Two destinations, and only one of them is reviewed

A field **with** a `target_column` is master data. It goes through `/review`
exactly as it always has, and "nothing overwrites master silently" is untouched.

A field **without** one — a subject mark, a one-off question — is written straight
to `student_records` at submit time and never appears in the queue. That is not a
hole in the rule, because every reason the rule exists is a property of master data
and not of that table: nothing else writes `student_records`, so there is no import
to lose a precedence argument to; there is no prior value to destroy, because a
mark is collected rather than confirmed; and the row is keyed by
`(student, field, period)`, so a correction overwrites the one value it is about.

What it buys is the point. A marks round is forty-six children times four subjects.
Asking the office to approve a hundred and eighty rows it has no way to check is
asking it to click Approve without reading — and a review nobody can actually
perform is worse than no review, because the record then claims someone checked.

The reasoning lives at the head of `src/lib/submissions.ts`.

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
- **`NEVER_ON_TEACHER_PAGE`** in `lib/auth/token.ts` keeps Aadhaar, Jan Aadhaar,
  date-of-birth **and photo** rounds off every durable page. Nothing to remember
  and nothing to tick.
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

**Settled, by the data rather than by us:** the class labels are the nineteen the
VPPS Fee Management App uses, character for character —

```
Nursery · JKG · SKG · Class 1 … Class 10
11 Arts · 11 Commerce · 11 Science · 12 Arts · 12 Commerce · 12 Science
```

The fee app is the source of truth for class allocation and corrected data goes
back to it, so the two systems join on the label. There is no `12 Sci` and no
`10 A`; inventing a shorter spelling breaks the join.

Every path that accepts a label normalises through `src/lib/classes.ts` and then
validates against that list, because request creation filters the roster on
`students.class_label` — **a label differing by one space produces an empty roster
with no error.** The order of the array is also the sort order: nineteen known
labels sorted by a fixed index is honest, where a parser inferring order from the
text sent both `Class 6` and `Nursery` to the end.

**Still open, and what each one blocks:**

1. **Max marks per FA subject.** 25 is assumed, unconfirmed against LEAD, and now
   baked into all sixteen generated `fa_*` fields. Wrong here means every mark
   validates against the wrong ceiling — see the warning at the head of
   `drizzle/seed/field_defs.ts`
2. **Whether `office` can approve into master.** Currently `office` can create
   requests but cannot import or approve. Loosening it is **two** sites, not one:
   `canApproveIntoMaster` in `src/lib/auth/session.ts`, and the direct call in
   `src/app/api/students/import/route.ts`. Note separately that
   `canManageSettings` is owner-only, so `admin` cannot reach the field registry
   or the user list either
3. **LEAD's `FA_Marks_Pattern.xlsx`.** The one thing blocking Phase 4; see the
   build status above
4. **The public subdomain.** The plan proposed `data.veerpatta.in`; nothing is
   configured yet, and `AUTH_URL` has to match whatever is chosen

**Since closed:** the field list (13 hand-written + 16 generated subject fields)
and the bus-route options (29 routes in `src/lib/routes.ts`, wired in at
`drizzle/seed/field_defs.ts`) are both settled. The real PSP export arrived and is
imported by `scripts/import-psp.ts`, which pinned the column mapping the
auto-mapper used to guess at.

---

*Document owner: Janmejay · Shri Veer Patta Senior Secondary School, Amet*
