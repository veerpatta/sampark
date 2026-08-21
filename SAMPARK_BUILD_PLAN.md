# Sampark — VPPS Data Desk

**Build plan · v1.0**
Shri Veer Patta Senior Secondary School, Amet, Rajsamand (Rajasthan)

---

## 1. What this is

A single-purpose internal web app that solves one problem: **collecting and updating student data from teachers who only use mobile phones and are not technical.**

The core mechanic is *verify, don't enter*:

> The school already holds most of the data. Instead of asking a teacher to produce data, we send them the data we already have and ask them to confirm or correct it.

A class teacher checking 40 mobile numbers is 40 taps and maybe 3 corrections — a five-minute job. Typing 40 mobile numbers is a forty-minute job nobody does. Every design decision below follows from this.

### What it is not

- Not a parent portal
- Not a multi-school SaaS product
- Not an ERP or a replacement for PSP / LEAD Nucleus
- Not a fee system (that is the separate VPPS Fee Management App)

Sampark is a **collection and reconciliation layer** that sits beside PSP. PSP stays the official record. Sampark is how we keep it accurate.

---

## 2. Non-negotiable principles

| # | Principle | Why |
|---|---|---|
| 1 | **No login for teachers** | Passwords are the single biggest adoption killer. A tokenised link, opened from WhatsApp, is the entire onboarding. |
| 2 | **Scoped links** | A request link opens exactly one group and exactly the fields requested. A teacher's durable link is a menu of *her own* open requests and nothing else — no other teacher's work, no navigation past it, and nothing archived or closed. |
| 3 | **Nothing overwrites master silently** | A correction to **master data** — any field with a `target_column` — is a *proposed change* in a review queue, and moves only on explicit approval. Same philosophy as the Fee App: append-only, corrections via review. Marks and one-off questions are not master data and land directly; see "two destinations" in section 6. |
| 4 | **Student ID is the key** | Never match by name. Student ID first, SR number as fallback. |
| 5 | **Validate at entry** | A 9-digit phone number or 30 marks out of 25 must be impossible to submit, not cleaned up later. |
| 6 | **Offline-tolerant** | Work saves to the phone as they type and submits when signal returns. Amet and the villages are not reliable. |
| 7 | **Bilingual by default** | Teacher-facing UI is Hindi-first with English support. Admin UI is English. |
| 8 | **Field registry is data, not code** | Adding a new field to collect is a database row, not a deployment. |
| 9 | **Everything exports to Excel** | The office runs on Excel. Any collected dataset must come out as a clean .xlsx. |
| 10 | **Don't break what works** | Teachers who won't use the link hand in paper. That is an acceptable outcome, not a failure. Build for the 80%. |

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15**, App Router, TypeScript | Server routes and UI in one deployable |
| Database | **Neon Postgres** (Singapore / aws-ap-southeast-1) | Serverless, generous free tier, DB branching |
| DB access | `@neondatabase/serverless` + **Drizzle ORM** | Type-safe, migrations in the repo |
| Styling | **Tailwind CSS v4** + custom token layer | Tokens carried over from the prototype |
| Admin auth | **Auth.js v5**, Credentials provider | 3–5 users; no third-party dependency, no cost |
| Teacher auth | **Token in URL** | No account, ever. The PIN this table used to offer was removed — see section 6 |
| Excel | **ExcelJS** | Read for import, write for export |
| CSV | **PapaParse** | PSP exports are usually CSV |
| Hosting | **Vercel** | Native Neon integration via the Vercel marketplace |
| Fonts | Anek Latin + Anek Devanagari + IBM Plex Mono | Anek is by Ek Type, built for Indian multi-script |

### Architecture note — the Supabase→Neon difference

Supabase would have given us Row Level Security plus a client-facing PostgREST API, so the teacher's browser could query the DB directly and RLS would enforce scoping.

**Neon has none of that.** There is no anonymous API surface. This means:

- The browser **never** connects to the database.
- Every read and write goes through a Next.js server route.
- Authorization is enforced in **one place**: the token resolver in `lib/auth/token.ts`.

This is a simplification, not a downgrade. The tradeoff we accept is that all security correctness lives in our own code, so the token resolver gets tests and gets reviewed carefully.

### Cost

| Service | Tier | Cost |
|---|---|---|
| Neon | Free (0.5 GB, autosuspend) | ₹0 — comfortably enough for ~2,000 students |
| Vercel | **Pro** | ~$20/mo |
| Domain | e.g. `data.veerpatta.in` subdomain | ₹0 if reusing existing domain |

> **Read this before deploying:** Vercel's Hobby tier is licensed for non-commercial use only. A school operations tool is a grey area at best. Budget for Pro (~₹1,700/mo) or self-host on a small VPS. Do not build on Hobby and discover this later.

---

## 4. Data model

### 4.1 Core tables

```sql
-- ============ MASTER RECORD ============
CREATE TABLE students (
  id              TEXT PRIMARY KEY,           -- VPPS student ID, e.g. 'S1001'
  sr_no           TEXT,
  admission_no    TEXT,
  class_label     TEXT NOT NULL,              -- one of the nineteen; see below
  section         TEXT,
  roll_no         INTEGER,
  name            TEXT NOT NULL,
  father_name     TEXT,
  mother_name     TEXT,
  phone           TEXT,
  alt_phone       TEXT,
  dob             DATE,
  gender          TEXT,
  category        TEXT,
  aadhaar         TEXT,
  jan_aadhaar     TEXT,
  village         TEXT,
  address         TEXT,
  bus_route       TEXT,
  house           TEXT,                       -- since shipped; see note
  aadhaar_last4   TEXT,                       -- since shipped; PSP masks Aadhaar
  photo_path      TEXT,                       -- since shipped; blob pathname
  status          TEXT NOT NULL DEFAULT 'active',  -- active | left | tc_issued
  source          TEXT DEFAULT 'psp',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON students (class_label, roll_no);
CREATE INDEX ON students (sr_no);
CREATE INDEX ON students (status);
```

**`class_label` is settled, and not the way this section guessed.** The nineteen
labels are the fee app's, character for character — `Nursery`, `JKG`, `SKG`,
`Class 1`…`Class 10`, `11 Arts`/`Commerce`/`Science`, `12 Arts`/`Commerce`/`Science`.
The fee app owns class allocation and corrected data goes back to it, so the two
systems join on the label; `12 Sci` would break that join. `src/lib/classes.ts`
holds the list and every path normalises through it. **This closes open decision
#3 in section 13.**

`house`, `aadhaar_last4` and `photo_path` were added after this section was
written. The lesson from adding them is in `src/lib/student-export.ts`: the
workbook's column list is now derived from the live schema and guarded by a test,
because the hand-written copy silently went two columns out of date.

```sql
-- ============ FIELD REGISTRY ============
-- Adding a collectable field is a row here, not a deploy.
CREATE TABLE field_defs (
  key             TEXT PRIMARY KEY,           -- 'phone', 'fa1_maths'
  label_en        TEXT NOT NULL,
  label_hi        TEXT NOT NULL,
  mode            TEXT NOT NULL,              -- 'verify' | 'collect'
  input_type      TEXT NOT NULL,              -- text | tel | date | number | select
  target_column   TEXT,                       -- students column, NULL for non-master data
  record_kind     TEXT,                       -- e.g. 'fa_marks' when target_column IS NULL
  max_value       NUMERIC,
  exact_len       INTEGER,                    -- 10 for phone, 12 for aadhaar
  pattern         TEXT,                       -- optional regex
  options         JSONB,                      -- for select
  sort_order      INTEGER DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true
);
```

`mode = 'verify'` means we already hold a value and want it confirmed.
`mode = 'collect'` means we hold nothing and want new data (marks, Aadhaar we've never had).

Fields whose `target_column IS NULL` write to `student_records` instead of `students` — this is how marks, term-scoped data, and anything repeating gets stored without bloating the master table.

```sql
-- ============ NON-MASTER DATA (marks, term-scoped values) ============
CREATE TABLE student_records (
  id          BIGSERIAL PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id),
  field_key   TEXT NOT NULL REFERENCES field_defs(key),
  period      TEXT NOT NULL,                  -- '2026-27/FA1'
  value       TEXT,
  request_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, field_key, period)
);
```

```sql
-- ============ PEOPLE ============
CREATE TABLE teachers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  classes         TEXT[] NOT NULL DEFAULT '{}',
  houses          TEXT[] NOT NULL DEFAULT '{}',  -- since shipped: house in-charge
  routes          TEXT[] NOT NULL DEFAULT '{}',  -- since shipped: route in-charge
  link_token      TEXT,                          -- since shipped: the durable /t/ link
  link_issued_at  TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE users (                          -- admin console only
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'office', -- owner | admin | office
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Roles: `owner` (Janmejay) can do everything including field registry and user management. `admin` can create requests and approve changes. `office` can create requests and view, but **cannot approve** changes into master.

```sql
-- ============ REQUESTS ============
CREATE TABLE requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL,         -- 16-char url-safe, crypto random
  title         TEXT NOT NULL,
  class_label   TEXT,                         -- NULLABLE: see note below
  teacher_id    TEXT NOT NULL REFERENCES teachers(id),
  field_keys    TEXT[] NOT NULL,
  period        TEXT,                         -- required when collecting marks
  due_date      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- open | submitted | closed | expired
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at     TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX ON requests (token);
```

**Two amendments to the table above.**

`class_label` is **nullable**. A round can be scoped to a house or a bus route
instead of a class, and those span classes — the frozen roster below is what
actually says who is in scope, so the label is a description rather than the
definition.

**The `pin` column is gone.** This plan offered an optional 4-digit gate on `/r/*`
(see section 5, and open decision #5); it was removed on request and a link is now
a pure bearer token. The threat model here already accepted forwarding as
proportionate — the same teacher carries a paper register with the same data — and
what remains is the short expiry, the three-day grace cut-off, close/reopen, and
the fact that a request link reaches exactly one group. Worth revisiting before an
Aadhaar collection round. See "The PIN was removed" in the README.

Since shipped and not in the table: `archived_at`, `sent_at`/`sent_by`,
`contact_phone`, and `batch_id` — a send-to-many round is one row in
`request_batches` and many requests beneath it.

```sql
-- ============ ROSTER SNAPSHOT ============
-- Freeze who was in scope, and what we held, at the moment of sending.
CREATE TABLE request_students (
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id),
  roll_no     INTEGER,
  snapshot    JSONB NOT NULL,                 -- the prefilled values as sent
  PRIMARY KEY (request_id, student_id)
);
```

> **Why snapshot matters:** if the master record changes between sending the link and reviewing the reply, "old value → new value" in the review screen must still refer to what the teacher actually saw. Without a snapshot, review becomes untrustworthy.

```sql
-- ============ SUBMISSIONS (APPEND-ONLY) ============
CREATE TABLE submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES requests(id),
  student_id    TEXT NOT NULL REFERENCES students(id),
  field_key     TEXT NOT NULL REFERENCES field_defs(key),
  action        TEXT NOT NULL,                -- confirmed | changed | not_present | absent
  old_value     TEXT,
  new_value     TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | auto
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_hash   TEXT                          -- coarse device fingerprint, anti-abuse only
);
CREATE INDEX ON submissions (request_id, review_status);
CREATE INDEX ON submissions (student_id, field_key);
```

```sql
-- ============ CHANGE LOG (the audit trail) ============
CREATE TABLE change_log (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  UUID NOT NULL REFERENCES submissions(id),
  student_id     TEXT NOT NULL,
  field_key      TEXT NOT NULL,
  from_value     TEXT,
  to_value       TEXT,
  decision       TEXT NOT NULL,               -- approved | rejected
  decided_by     TEXT NOT NULL REFERENCES users(id),
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT
);
```

### 4.2 Append-only enforcement

`submissions` and `change_log` must never be edited or deleted by the application. Enforce at the database level, not in code:

```sql
CREATE ROLE app_rw LOGIN PASSWORD '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON students, requests, request_students,
      student_records, teachers, users, field_defs TO app_rw;

-- append-only tables
GRANT SELECT, INSERT ON submissions, change_log TO app_rw;
REVOKE UPDATE, DELETE ON change_log FROM app_rw;
-- submissions.review_status is the sole updatable column
REVOKE UPDATE ON submissions FROM app_rw;
GRANT UPDATE (review_status) ON submissions TO app_rw;
REVOKE DELETE ON submissions FROM app_rw;
```

Migrations run as the Neon owner role. The app runs as `app_rw` and has no DDL rights.

### 4.3 Useful view — NOT FOLLOWED, and the view is dropped

This section proposed a `request_progress` view supplying `roster_size`,
`students_answered` and `changes_pending`. It was built, and it was **dropped**:
`drizzle/sql/grants.sql` now carries an explicit `DROP VIEW IF EXISTS
request_progress` and a note headed "request_progress IS GONE, AND PLAN SECTION
4.3 IS NOT BEING FOLLOWED".

The reason is worth keeping. It disagreed with the board on both numbers it
supplied. `students_answered` counted a child who answered *any* field, so a round
asking for three things called a child done when she had one — the teacher's page
said 46/46 and the office board said 40 of 46, about the same round. Two
definitions of "answered" is a bug that renders as a support call.

There is now exactly one definition, in TypeScript where the board can share it:
`isAnsweredFully` in `src/lib/answered.ts` — covered on **every** field the request
asked about. `src/lib/progress.ts` builds the per-teacher rollup on top of it.

**Do not re-add the view.** A second place that computes progress is a second
answer to the same question.

---

## 5. Security model

Everything hinges on the token. Treat it as a bearer credential.

| Control | Implementation |
|---|---|
| Token generation | `crypto.randomBytes(12).toString('base64url')` — 16 chars, ~96 bits |
| Token scope | A request token resolves to exactly one `request` → one group → one field set. A teacher token resolves to that one teacher's currently-open requests and nothing else. Both enforced server-side in `lib/auth/token.ts` |
| Expiry | Rejected after `due_date + 3 days` grace, or once `status = 'closed'` |
| Re-submission | Allowed until admin closes the request. Later submissions append; they never overwrite |
| ~~Optional PIN~~ | **Removed.** A link is a pure bearer token; see the note in section 4.1. Sensitive rounds are kept off the durable page instead, by `NEVER_ON_TEACHER_PAGE` — Aadhaar, Jan Aadhaar, DOB and photo |
| Rate limiting | Four budgets, counted in a Neon table rather than Upstash: 30/min per token and 100/hour per IP, plus 60/min and 500/hour for photo uploads, so a class of forty-six photographs does not starve her own answer flushes. Not in memory — Vercel runs many instances and each would keep a private tally |
| Indexing | `X-Robots-Tag: noindex, nofollow` on all `/r/*` responses |
| Referrer leak | `Referrer-Policy: no-referrer` on `/r/*` so the token never leaks to third-party assets |
| PII in URL | Only the token. No student ID, no name, no class |
| Transport | HTTPS only, HSTS, Vercel default |
| DB credentials | Pooled Neon connection string in Vercel env vars only. Never `NEXT_PUBLIC_` |
| Admin session | Auth.js JWT session, 8-hour expiry, secure httpOnly cookie |
| Approval rights | `office` role cannot approve into master. Only `admin` / `owner` |

**Threat we accept:** a teacher forwards a link. A request link (`/r/`) exposes one group's names and numbers; a durable teacher link (`/t/`) exposes the list of whatever is currently open for that one teacher, and through it those groups' rosters. It never reaches another teacher's work. This is proportionate for the same reason it always was — the same teacher already carries a paper register with the same data — but it is a larger blast radius than a single request link, and it is bounded by four things rather than by scope alone: `/r/` links still expire on `due_date + 3 days`; the durable link lists only what is open, so it shrinks to nothing between rounds; the owner can rotate one teacher's link or revoke every link from Settings, instantly and without a deploy; and a round collecting Aadhaar, Jan Aadhaar or date of birth never appears on a durable page at all — it goes out one message at a time, the way every round did before.

**Threat we do not accept:** token enumeration. 96 bits of entropy plus rate limiting makes guessing infeasible.

---

## 6. Application surface

### Routes

```
PUBLIC (no auth)
  /r/[token]                     teacher form — the only page teachers ever see
  /r/[token]/done                confirmation
  /t/[token]                     the durable teacher link — see section 5

ADMIN (Auth.js session)
  /login
  /                              dashboard: open requests, overdue, pending review count
  /requests                      per-teacher progress board; ?view=rounds for the
                                 one-row-per-link table, which owns close/archive
  /requests/new                  builder: audience → fields → teacher → due date
  /requests/bulk                 send-to-many: many groups in one round
  /requests/batch/[id]           one send-to-many round, as one thing
  /requests/[id]                 detail, share panel, progress, close/reopen
  /review                        approval queue, batch approve/reject
  /marks                         a marks round: who has entered, and what
  /students                      master, search, filter
  /students/[id]                 single record + its full change history
  /students/import               CSV/XLSX upload with column mapping and dry-run preview
  /settings                      index of the six below
  /settings/fields               field registry editor
  /settings/teachers             teachers, their classes, houses and routes
  /settings/subjects             who teaches what
  /settings/users                admin users (owner only)
  /settings/audit                change log
```

An audience is a class, a **house** or a **bus route**; the last two span classes,
which is why `requests.class_label` is nullable.

### API

**This section proposed a REST endpoint per mutation. That is not what was built.**
Admin mutations landed as **Next.js Server Actions**, because every one of them is
submitted from a form on a page that is already behind the session gate — a route
would mean re-deriving the user, hand-writing the fetch, and keeping a second copy
of the argument types. What is genuinely an API is what a *non-page* client calls:
the teacher's phone, a download, an upload.

`/api/requests/[id]`, `/close`, `/reopen`, `GET`/`POST /api/review` were never
built and should not be. **Do not create them.**

```
ROUTES (src/app/api/**/route.ts)
  POST   /api/requests                   create request + freeze roster snapshot
  GET    /api/r/[token]                  → { request, fieldDefs, roster[] }  (rate limited)
  POST   /api/r/[token]                  → submit batch                      (rate limited)
  GET    /api/r/[token]/photo            her own roster's photos             (rate limited)
  GET    /api/photos                     the same bytes, admin session instead
  POST   /api/students/import            multipart, dry-run flag
  GET    /api/export/students.xlsx       master record; honours the /students filters
  GET    /api/export/marks.xlsx          one period, split by who entered it
  GET    /api/export/request/[id]        one round
  GET    /api/export/batch/[id]          a whole send-to-many round, one file
  /api/auth/[...nextauth]

SERVER ACTIONS ("use server")
  review/actions.ts              decide() — THE review transaction, below
  requests/[id]/actions.ts       close, reopen, archive, remind, rotate
  requests/bulk/actions.ts       plan and send a fan-out
  requests/batch/[id]/actions.ts the round as one thing
  requests/adhoc-actions.ts      one-off questions
  settings/{fields,subjects,teachers,users}/actions.ts
  login/actions.ts
```

Both photo routes exist because there are two readers with two different proofs of
entitlement — an admin session, and a teacher's own frozen roster. Neither store
is public; there is no URL to a photograph of a child that works without one.

### Critical: the review transaction

Approving must be atomic. In one transaction:

1. `UPDATE submissions SET review_status = 'approved' WHERE id = ANY(...) AND review_status = 'pending'`
2. `INSERT INTO change_log (...)` one row per approved submission
3. `UPDATE students SET <target_column> = new_value`
4. `UPDATE students SET updated_at = now()`

The `AND review_status = 'pending'` guard makes double-approval a no-op. Do not skip it.

**Step 3 lost its second half: two destinations, and only one is reviewed.**

A field with a `target_column` is master data and takes the path above, unchanged.
A field **without** one — a subject mark, a one-off `q_*` question — is written
straight to `student_records` at submit time by `recordSubmissions`, with
`review_status = 'applied'`, and never enters the queue. The approval path still
contains a `student_records` branch, but it is a drain for old rows rather than a
route anything new travels.

This is not a hole in principle 3, because every reason that principle exists is a
property of master data and not of `student_records`: nothing else writes that
table, so there is no import to lose a precedence argument to and no
`value_sources` to get wrong; there is no prior value to destroy, since a mark is
collected rather than confirmed; and the row is keyed by
`(student, field, period)`, so a correction overwrites the one value it is about.

What it buys is the point. A marks round is forty-six children times four
subjects. Asking the office to approve a hundred and eighty rows it cannot check
is asking it to click Approve without reading — and a review nobody can perform is
worse than none, because the record then claims someone checked. The full
reasoning is at the head of `src/lib/submissions.ts`.

---

## 7. Repo structure

```
sampark/
├── README.md
├── SAMPARK_BUILD_PLAN.md
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── package.json
│
├── drizzle/
│   ├── schema.ts
│   ├── migrations/
│   └── seed/
│       ├── field_defs.ts
│       ├── sources.ts          ← precedence sources + field_sources
│       └── teachers.ts         ← ships EMPTY; the repo is public
│
├── src/
│   ├── app/
│   │   ├── (admin)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── requests/           ← new · bulk · batch/[id] · [id]
│   │   │   ├── review/
│   │   │   ├── marks/
│   │   │   ├── students/
│   │   │   └── settings/
│   │   ├── r/[token]/
│   │   │   ├── page.tsx            ← teacher form, no admin shell
│   │   │   └── done/page.tsx
│   │   ├── t/[token]/page.tsx      ← the durable teacher link
│   │   ├── login/page.tsx
│   │   └── api/
│   │
│   ├── components/
│   │   ├── admin/
│   │   ├── ui/                     ← controls.ts: class strings, not components
│   │   └── teacher/
│   │       ├── StudentRow.tsx      ← सही है / बदलें / नहीं है
│   │       ├── ProgressRail.tsx
│   │       ├── draft.ts            ← local draft, keyed by token
│   │       ├── autosave.ts         ← save as she types, tuned to the rate limit
│   │       └── photo-queue.ts      ← IndexedDB, drains one at a time
│   │
│   ├── lib/
│   │   ├── db.ts
│   │   ├── auth/
│   │   │   ├── session.ts
│   │   │   └── token.ts            ← the one place authz lives
│   │   ├── fields.ts               ← registry loader + validators
│   │   ├── excel.ts
│   │   ├── ratelimit.ts
│   │   └── whatsapp.ts             ← message template builder
│   │
│   └── styles/
│       └── tokens.css
│
└── public/
    └── manifest.json               ← PWA, so teachers can "add to home screen"
```

### Environment variables

```bash
# .env.example
DATABASE_URL=                # Neon pooled connection string (app_rw role)
DATABASE_URL_UNPOOLED=       # direct connection, for migrations only
AUTH_SECRET=                 # openssl rand -base64 32
AUTH_URL=https://data.veerpatta.in
ACADEMIC_YEAR=2026-27
BLOB_READ_WRITE_TOKEN=       # private Vercel Blob store, for student photos
```

Never prefix any of these with `NEXT_PUBLIC_`.

**Two settings this list used to carry have been deleted, for the same reason
each time: nothing read them, and an advertised setting nobody reads is worse
than an absent one — it invites somebody to set it and expect an effect.**

- `APP_TIMEZONE=Asia/Kolkata`. The school's zone is a constant in
  `src/lib/today.ts` because a client component cannot read a server-only
  variable, so making it configurable would risk the two halves of the app
  disagreeing about what day it is — which is the exact bug that file exists to
  fix. A second school in a second zone belongs on the school record.
- `UPSTASH_REDIS_REST_URL` / `_TOKEN`. Rate limiting is counted in Postgres, in
  the `rate_limits` table — see section 5 and `src/lib/ratelimit.ts`.

`BLOB_READ_WRITE_TOKEN` is read by the `@vercel/blob` SDK rather than by our own
code, so it will not show up in a `process.env` search, but a photo round cannot
run without it.

---

## 8. Build phases

Each phase ends with something demonstrable. Do not start the next phase until the current one works end to end.

### Phase 0 — Skeleton (half day)

- Create the GitHub repo `sampark`, private
- `npx create-next-app@latest --typescript --tailwind --app`
- Create the Neon project in **aws-ap-southeast-1 (Singapore)**
- Create two Neon branches: `main` (production) and `dev`
- Connect the repo to Vercel, add env vars, confirm a deploy goes green
- Point `data.veerpatta.in` at the Vercel deployment

**Done when:** a blank page is live on the real domain.

> **Correction (Aug 2026): Neon has no Mumbai region.** This plan originally
> specified `ap-south-1`. Neon's supported AWS regions are us-east-1, us-east-2,
> us-west-2, eu-central-1, eu-west-2, **ap-southeast-1 (Singapore)**,
> ap-southeast-2 and sa-east-1. Singapore is the nearest to Rajasthan and is what
> we use. A Neon project's region cannot be changed after creation, so if Neon
> ever adds Mumbai the move means creating a new project and migrating with
> `pg_dump`/`pg_restore`. Worth revisiting only if latency actually hurts —
> Singapore adds roughly 30–50 ms per round trip versus a hypothetical Mumbai.
> There is a standing community request for `aws-ap-south-1`.

### Phase 1 — Schema and master data (1 day)

- Write `drizzle/schema.ts` from section 4, generate and run the first migration
- Create the `app_rw` role and apply the grants from 4.2
- Seed `field_defs` with the starting field list (section 9)
- Seed `teachers`
- Build `/students/import`: upload CSV/XLSX → map columns → **dry-run preview showing what would change** → confirm → insert
- Build `/students` list with search and class filter

**Done when:** a real PSP export is loaded and browsable.

> Import rules, carried over from the Fee App: match on Student ID first, then SR number, **never on name**. Blank cells mean no change. Missing SR is a warning, not a blocker. A row with only name + class is valid.

### Phase 2 — Requests and the teacher link, read-only (1 day)

- `/requests/new` builder: class → template or custom fields → teacher → due date
- On create: generate token, freeze the roster snapshot into `request_students`
- `/r/[token]` renders the roster with prefilled values — display only, no submit yet
- Share panel: link, copy button, prefilled Hindi WhatsApp message
- `X-Robots-Tag` and `Referrer-Policy` headers on `/r/*`

**Done when:** you open a link on your own phone and see Class 6 with the right numbers.

### Phase 3 — Submission and review (2 days)

- Teacher row interactions: `सही है` / `बदलें` / `नहीं है`, marks entry for collect-mode
- Client-side validation from the field registry, re-validated server-side (never trust the client)
- Progress rail
- `POST /api/r/[token]` writes submissions; **confirmations that match the snapshot produce no reviewable change**
- `/review` queue with batch approve/reject in one transaction
- Approval writes `change_log` and updates `students` / `student_records`

**Done when:** a change made on your phone appears in review and lands in master after you approve.

### Phase 4 — Export and share (half day)

- `GET /api/export/students.xlsx` — one sheet per class. Since shipped and grown:
  it honours the `/students` filters, carries house, masked Aadhaar and
  provenance, and draws each child's photograph into the sheet at print
  resolution. Its column list is derived from the live schema, not hand-written —
  see `src/lib/student-export.ts` and the drift guard in `tests/student-export.test.ts`
- `GET /api/export/request/[id]` — collected data, shaped for its purpose. Plus
  `/api/export/batch/[id]`, since a send-to-many round is one file
- `GET /api/export/marks.xlsx` — **shipped.** The office's own workbook for a
  period, split by whoever entered each mark, with a summary sheet leading
  because the first question after a marks round is "who has not sent theirs"
- **FA marks export must match the existing `FA_Marks_Pattern.xlsx` layout exactly** (header rows for school name / course type / exam date / total marks, then `Student Name | Maths | Physics | Chemistry | Biology | Science combine`, with the combine column computed)
- WhatsApp reminder builder on `/requests/[id]` for teachers who haven't submitted.
  Since shipped, with one rule worth keeping: **one nudge per person, never one
  per link** — a teacher with three classes was getting three near-identical
  messages. See `src/lib/reminders.ts`

**Done when:** you can hand LEAD the FA file without touching it.

**Still open, and it is the only thing left in this phase.** The FA export is
blocked on being given `FA_Marks_Pattern.xlsx` itself: "matches the pattern" is
not something that can be written from a description, and a near-miss means
someone redoes it by hand in Excel, which is the entire problem it exists to
remove. Everything else here shipped. See the TODO at the foot of `src/lib/excel.ts`.

### Phase 5 — Offline and PWA (1 day)

- Local draft persistence keyed by token, so a dropped connection loses nothing
- Submit queue: retry on reconnect, clear visual state for "saved on phone" vs "sent to school"
- `manifest.json` + service worker so teachers can add it to their home screen
- Idempotency key on submit so a double-tap doesn't double-write

**Done when:** you can fill a form in airplane mode, re-enable signal, and it submits.

### Phase 6 — Hardening (1 day)

- Rate limiting on `/api/r/*`
- Token expiry and close/reopen
- `/settings/fields` registry editor
- `/settings/audit` change log view
- Tests on `lib/auth/token.ts` and the review transaction — these two are where a bug is expensive
- Neon PITR confirmed; weekly verified `pg_dump`. **Not to Google Drive** —
  `scripts/backup.ps1` writes to a directory outside the repo, and the dump holds
  every student's name, phone number and Aadhaar number, so it stays off shared
  drives. See the README's Backups section, including the 6-hour PITR retention

**Total: roughly 6–7 working days of build.**

---

## 9. Starting field registry

Seed `field_defs` with these. Add to it as needs appear — it's a row, not a deploy.

| key | label_en | label_hi | mode | type | target | validation |
|---|---|---|---|---|---|---|
| `phone` | Mobile number | मोबाइल नंबर | verify | tel | `phone` | exactly 10 digits |
| `alt_phone` | Alternate mobile | दूसरा नंबर | verify | tel | `alt_phone` | exactly 10 digits |
| `father_name` | Father's name | पिता का नाम | verify | text | `father_name` | — |
| `mother_name` | Mother's name | माता का नाम | verify | text | `mother_name` | — |
| `dob` | Date of birth | जन्म तिथि | verify | date | `dob` | not future, age 2–22 |
| `aadhaar` | Aadhaar number | आधार नंबर | **collect** | tel | `aadhaar` | exactly 12 digits |
| `jan_aadhaar` | Jan Aadhaar | जन आधार | **collect** | text | `jan_aadhaar` | — |
| `village` | Village | गाँव | **collect** | text | `village` | — |
| `bus_route` | Bus route | बस रूट | verify | select | `bus_route` | from route list |
| `category` | Category | श्रेणी | verify | select | `category` | GEN/OBC/SC/ST/EWS |
| `gender` | Gender | लिंग | verify | select | `gender` | — |
| `house` | House | सदन | verify | select | `house` | one of the four |
| `photo` | Photograph | फ़ोटो | collect | photo | `photo_path` | JPEG, ≤1.5 MB |
| `fa_*` | per subject | | collect | number | — (`fa_marks`) | 0 to max |

**As built: 13 hand-written fields plus 16 generated, not the fourteen above.**
Three corrections worth carrying, because each was learned rather than decided:

- **`aadhaar`, `jan_aadhaar` and `village` are `collect`, not `verify`.** Verify
  mode shows the teacher what we hold and asks her to confirm it. PSP holds none
  of these — its Aadhaar column is masked, which is why `students.aadhaar_last4`
  exists — so there is nothing to show and confirming a blank is not a question.
- **The `fa_*` rows are generated, not written.** Sixteen of them, from `SUBJECTS`
  in `src/lib/subjects.ts`, which also supplies their `sort_order`. Adding a
  subject is one entry in that array; hand-maintaining sixteen near-identical rows
  is sixteen chances to mistype a key.
- **`bus_route`'s option list is populated** — 29 routes in `src/lib/routes.ts`,
  wired in at `drizzle/seed/field_defs.ts`.

**Templates** (a saved field set + a name):

- Mobile number update → `phone`, `alt_phone`
- Parent names → `father_name`, `mother_name`
- Aadhaar drive → `aadhaar`, `dob`
- Jan Aadhaar / DBT → `jan_aadhaar`, `category`
- Transport → `bus_route`, `village`
- FA marks (Science) → the four `fa_*` fields

### Fields to confirm before Phase 1

Before seeding, decide what you actually need to keep current. Candidates worth considering:

- Bank account / DBT details for scholarship schemes
- Caste and income certificate status and expiry
- Sibling links (for sibling concession)
- Previous school / TC status
- Blood group and medical notes
- Parent occupation (useful for admissions marketing segmentation)

Get the first fifteen right; the rest can accrete.

---

## 10. Rollout

Do not launch to all teachers at once. Adoption failure is very hard to recover from — teachers who conclude "this doesn't work" will not try again.

**Week 1 — Pilot.** Two teachers, one class each, the simplest possible request: mobile number update. Sit with them the first time. Watch where they hesitate; that's your bug list.

**Week 2 — Fix and widen.** Address what the pilot exposed. Roll out to all class teachers for the same mobile-number request. Announce it in the staff meeting, not on WhatsApp — a face-to-face two-minute demo is worth ten reminder messages.

**Week 3 — Second field set.** Aadhaar / Jan Aadhaar. This is the real test: it's data teachers must actually chase from parents, not just confirm.

**Week 4 — FA marks.** Only once the confirm-flow is habitual.

### What makes this stick

- **The status board is the enforcement mechanism.** Share "8 of 11 classes submitted" in the staff group. Nobody wants to be in the 3.
- **Deadlines must be short.** Five days, not three weeks. A long deadline means it gets forgotten.
- **Accept paper from holdouts.** Two teachers will not use it. Take their register page, have the office enter it, and don't make it a fight.
- **Show the payoff.** When a fee reminder actually reaches a parent because a teacher fixed a number, say so by name in the staff group.

---

## 11. Interaction with existing systems

| System | Relationship |
|---|---|
| **PSP** | Remains the official record. Sampark imports from it and produces corrected exports to push back. One-way in, one-way out — no live sync. |
| **LEAD Nucleus ERP** | Untouched. Sampark exports in whatever shape LEAD asks for. |
| **VPPS Fee Management App** | Separate app, separate database. Sampark is where a corrected parent mobile number *originates*; export from Sampark and import into the fee app, or later connect them. Do not merge them now. |
| **AiSensy WhatsApp** | Phase 7 candidate: send the request link as a template message instead of a manual copy-paste. Only after the manual flow is proven. |

---

## 12. Deliberately out of scope for v1

Adding any of these before v1 ships will sink it.

**Student PHOTO upload has since shipped** and is no longer on this list. It
went in as an ordinary `field_defs` row (`photo`, `inputType: 'photo'`,
`targetColumn: 'photo_path'`), so it rides the same request → frozen snapshot →
review → master pipeline as a phone number rather than being a second pipeline
of its own. Bytes live in a **private** Vercel Blob store and are read back only
through `/api/photos` (admin session) or `/api/r/<token>/photo` (the teacher's
own frozen roster) — there is no public URL to a photograph of a child. See
`src/lib/photos.ts`. Document upload is still out.

Since then, photographs also **print**. The students workbook embeds the full
800px image and draws it at 96px — about an inch — because an inch at 300dpi
wants roughly 300px of source, and the 96px thumbnail it used to embed came out
visibly soft. A printed class list with a recognisable face on it is the one
thing the office wants that file for. They render as pictures on the teacher's
own screen too, rather than as a blob pathname. See `src/lib/photo-store.ts`.

- Parent-facing access of any kind
- Document upload
- Attendance
- Live two-way sync with PSP or LEAD
- Multi-school support
- Native mobile apps
- Automated WhatsApp sending
- Analytics dashboards beyond the request status board

---

## 13. Open decisions

| # | Question | Needed by | Status |
|---|---|---|---|
| 1 | Final field list for `field_defs` seed | Phase 1 | **Closed** — 13 hand-written + 16 generated `fa_*`; bus routes populated (29) |
| 2 | A real PSP export (one class is enough) to fix the import column mapping | Phase 1 | **Closed** — arrived; see `scripts/import-psp.ts` |
| 3 | Class label convention — `12 Sci` vs `12-A Science` vs stream as a separate column | Phase 1 | **Closed by the data** — the fee app's nineteen, verbatim. See 4.1 |
| 4 | Who gets `admin` vs `office` role — specifically, can Komal Mam approve into master? | Phase 3 | **Open.** Loosening it is two sites, not one: `canApproveIntoMaster`, and the direct call in `api/students/import/route.ts` |
| 5 | ~~Optional PIN on by default, or only for Aadhaar collection?~~ | Phase 3 | **Moot** — the PIN was removed |
| 6 | Subdomain: `data.veerpatta.in` or something teacher-friendlier and shorter | Phase 0 | Open |
| 7 | Max marks per FA subject — 25 assumed, confirm against LEAD's pattern | Phase 4 | **Open, and now load-bearing** — assumed across all sixteen generated fields |

---

## 14. Codex / Claude Code prompts

> **Superseded (Aug 2026) — see [PROMPTS.md](./PROMPTS.md).** The prompts below
> were written before the Phase 0 scaffold existed and describe work that is now
> done (`drizzle/schema.ts`, the field registry seed, the `/r/[token]` route and
> its headers). Following them verbatim would produce duplicate work. They are
> kept here because they still capture the intent of each phase accurately.

One prompt per phase. Run them in order and review the diff before merging.

**Phase 1**
> In this Next.js + Drizzle + Neon repo, implement the schema in section 4 of SAMPARK_BUILD_PLAN.md as `drizzle/schema.ts`. Generate the migration. Write a seed script for `field_defs` from section 9 and `teachers`. Then build `/students/import`: accept CSV or XLSX, let the user map columns to fields, run a dry-run that reports would-insert / would-update / would-skip counts with a per-row preview, and only write on explicit confirmation. Match on student ID first, then SR number, never on name. Blank cells mean no change.

**Phase 2**
> Implement request creation. `POST /api/requests` generates a 16-char url-safe crypto-random token, inserts the request, and freezes the roster into `request_students` with a JSONB snapshot of the current values for the requested fields. Build `/requests/new` and `/requests`. Build `/r/[token]` as a server component that resolves the token in `lib/auth/token.ts`, returns 404 for invalid/expired/closed tokens, and renders the roster read-only. Add `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` headers on `/r/*` in next.config.ts.

**Phase 3**
> Build the teacher submit flow. Each student row has तीन actions: सही है (confirm), बदलें (correct, reveals inputs), नहीं है (not in class). Marks-mode fields skip the confirm step and show numeric inputs directly. Validate client-side from the field registry and re-validate identically server-side. `POST /api/r/[token]` inserts submissions; a confirmation matching the frozen snapshot must produce action='confirmed' with no reviewable change. Then build `/review` with batch approve/reject in a single transaction that guards on `review_status = 'pending'`, writes change_log, and updates students or student_records per the field's target.

---

## 15. Success criteria

v1 is working when:

1. A class teacher completes a mobile-number request on her own phone in under five minutes, without being shown how twice.
2. At least 8 of 11 class teachers submit before the deadline without individual chasing.
3. The number of students with a missing or wrong mobile number drops measurably and you can name the figure.
4. The FA marks file goes to LEAD without any manual Excel work.
5. Every change to a student record has a name and a timestamp attached to it.

---

*Document owner: Janmejay · Shri Veer Patta Senior Secondary School, Amet*
*Companion prototype: `sampark-vpps-data-desk.jsx`*
