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
| 2 | **Scoped links** | A link opens exactly one class and exactly the fields requested. No menu, no navigation, no way to see or damage anything else. |
| 3 | **Nothing overwrites master silently** | Every teacher submission is a *proposed change* in a review queue. Master data moves only on explicit approval. Same philosophy as the Fee App: append-only, corrections via review. |
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
| Teacher auth | **Token in URL** + optional 4-digit PIN | No account, ever |
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
  class_label     TEXT NOT NULL,              -- '6', '9', '12 Sci'
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
  status          TEXT NOT NULL DEFAULT 'active',  -- active | left | tc_issued
  source          TEXT DEFAULT 'psp',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON students (class_label, roll_no);
CREATE INDEX ON students (sr_no);
CREATE INDEX ON students (status);
```

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
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  classes      TEXT[] NOT NULL DEFAULT '{}',
  active       BOOLEAN NOT NULL DEFAULT true
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
  class_label   TEXT NOT NULL,
  teacher_id    TEXT NOT NULL REFERENCES teachers(id),
  field_keys    TEXT[] NOT NULL,
  period        TEXT,                         -- required when collecting marks
  due_date      DATE NOT NULL,
  pin           TEXT,                         -- optional 4-digit gate
  status        TEXT NOT NULL DEFAULT 'open', -- open | submitted | closed | expired
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at     TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX ON requests (token);
```

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

### 4.3 Useful view

```sql
CREATE VIEW request_progress AS
SELECT r.id, r.title, r.class_label, t.name AS teacher, r.due_date, r.status,
       (SELECT count(*) FROM request_students rs WHERE rs.request_id = r.id)            AS roster_size,
       (SELECT count(DISTINCT s.student_id) FROM submissions s WHERE s.request_id = r.id) AS students_answered,
       (SELECT count(*) FROM submissions s WHERE s.request_id = r.id
          AND s.review_status = 'pending' AND s.action = 'changed')                     AS changes_pending
FROM requests r JOIN teachers t ON t.id = r.teacher_id;
```

---

## 5. Security model

Everything hinges on the token. Treat it as a bearer credential.

| Control | Implementation |
|---|---|
| Token generation | `crypto.randomBytes(12).toString('base64url')` — 16 chars, ~96 bits |
| Token scope | Resolves to exactly one `request` → one class → one field set. Enforced server-side in `lib/auth/token.ts` |
| Expiry | Rejected after `due_date + 3 days` grace, or once `status = 'closed'` |
| Re-submission | Allowed until admin closes the request. Later submissions append; they never overwrite |
| Optional PIN | Last 4 digits of the teacher's registered mobile. Off by default; on for Aadhaar/DOB collection |
| Rate limiting | 30 requests/min per token, 100/hour per IP. Upstash Redis or a simple Neon counter table |
| Indexing | `X-Robots-Tag: noindex, nofollow` on all `/r/*` responses |
| Referrer leak | `Referrer-Policy: no-referrer` on `/r/*` so the token never leaks to third-party assets |
| PII in URL | Only the token. No student ID, no name, no class |
| Transport | HTTPS only, HSTS, Vercel default |
| DB credentials | Pooled Neon connection string in Vercel env vars only. Never `NEXT_PUBLIC_` |
| Admin session | Auth.js JWT session, 8-hour expiry, secure httpOnly cookie |
| Approval rights | `office` role cannot approve into master. Only `admin` / `owner` |

**Threat we accept:** a teacher forwards their link to someone else, who then sees that class's names and phone numbers. Mitigations are the short expiry, the optional PIN, and the fact that no link exposes more than one class. This is proportionate — the same teacher already has a paper register with the same data.

**Threat we do not accept:** token enumeration. 96 bits of entropy plus rate limiting makes guessing infeasible.

---

## 6. Application surface

### Routes

```
PUBLIC (no auth)
  /r/[token]                     teacher form — the only page teachers ever see
  /r/[token]/done                confirmation

ADMIN (Auth.js session)
  /login
  /                              dashboard: open requests, overdue, pending review count
  /requests                      status board
  /requests/new                  builder: class → fields → teacher → due date
  /requests/[id]                 detail, share panel, progress, close/reopen
  /review                        approval queue, batch approve/reject
  /students                      master, search, filter
  /students/[id]                 single record + its full change history
  /students/import               CSV/XLSX upload with column mapping and dry-run preview
  /settings/fields               field registry editor
  /settings/teachers             teachers and their classes
  /settings/users                admin users (owner only)
  /settings/audit                change log
```

### API

```
POST   /api/requests                     create request + freeze roster snapshot
GET    /api/requests/[id]
POST   /api/requests/[id]/close
POST   /api/requests/[id]/reopen

GET    /api/r/[token]                    → { request, fieldDefs, roster[] }   (rate limited)
POST   /api/r/[token]                    → submit batch                       (rate limited)

GET    /api/review?requestId=            pending changes
POST   /api/review                       { keys[], decision } — transactional

POST   /api/students/import              multipart, dry-run flag
GET    /api/export/students.xlsx
GET    /api/export/request/[id].xlsx     collected data in the shape you need
```

### Critical: the review transaction

Approving must be atomic. In one transaction:

1. `UPDATE submissions SET review_status = 'approved' WHERE id = ANY(...) AND review_status = 'pending'`
2. `INSERT INTO change_log (...)` one row per approved submission
3. `UPDATE students SET <target_column> = new_value` **or** `INSERT INTO student_records ... ON CONFLICT DO UPDATE`
4. `UPDATE students SET updated_at = now()`

The `AND review_status = 'pending'` guard makes double-approval a no-op. Do not skip it.

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
│       ├── teachers.ts
│       └── students.sample.csv
│
├── src/
│   ├── app/
│   │   ├── (admin)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── requests/
│   │   │   ├── review/
│   │   │   ├── students/
│   │   │   └── settings/
│   │   ├── r/[token]/
│   │   │   ├── page.tsx            ← teacher form, no admin shell
│   │   │   └── done/page.tsx
│   │   ├── login/page.tsx
│   │   └── api/
│   │
│   ├── components/
│   │   ├── admin/
│   │   └── teacher/
│   │       ├── StudentRow.tsx      ← सही है / बदलें / नहीं है
│   │       ├── ProgressRail.tsx
│   │       └── OfflineQueue.tsx
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
APP_TIMEZONE=Asia/Kolkata
ACADEMIC_YEAR=2026-27
UPSTASH_REDIS_REST_URL=      # optional, rate limiting
UPSTASH_REDIS_REST_TOKEN=
```

Never prefix any of these with `NEXT_PUBLIC_`.

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

- `GET /api/export/students.xlsx` — one sheet per class
- `GET /api/export/request/[id].xlsx` — collected data, shaped for its purpose
- **FA marks export must match the existing `FA_Marks_Pattern.xlsx` layout exactly** (header rows for school name / course type / exam date / total marks, then `Student Name | Maths | Physics | Chemistry | Biology | Science combine`, with the combine column computed)
- WhatsApp reminder builder on `/requests/[id]` for teachers who haven't submitted

**Done when:** you can hand LEAD the FA file without touching it.

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
- Neon PITR confirmed; weekly `pg_dump` to Google Drive

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
| `aadhaar` | Aadhaar number | आधार नंबर | verify | tel | `aadhaar` | exactly 12 digits |
| `jan_aadhaar` | Jan Aadhaar | जन आधार | verify | text | `jan_aadhaar` | — |
| `village` | Village | गाँव | verify | text | `village` | — |
| `bus_route` | Bus route | बस रूट | verify | select | `bus_route` | from route list |
| `category` | Category | श्रेणी | verify | select | `category` | GEN/OBC/SC/ST/EWS |
| `fa_maths` | FA Maths | गणित | collect | number | — (`fa_marks`) | 0 to max |
| `fa_physics` | FA Physics | भौतिक विज्ञान | collect | number | — (`fa_marks`) | 0 to max |
| `fa_chemistry` | FA Chemistry | रसायन विज्ञान | collect | number | — (`fa_marks`) | 0 to max |
| `fa_biology` | FA Biology | जीव विज्ञान | collect | number | — (`fa_marks`) | 0 to max |

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

- Parent-facing access of any kind
- Photo or document upload
- Attendance
- Live two-way sync with PSP or LEAD
- Multi-school support
- Native mobile apps
- Automated WhatsApp sending
- Analytics dashboards beyond the request status board

---

## 13. Open decisions

| # | Question | Needed by |
|---|---|---|
| 1 | Final field list for `field_defs` seed | Phase 1 |
| 2 | A real PSP export (one class is enough) to fix the import column mapping | Phase 1 |
| 3 | Class label convention — `12 Sci` vs `12-A Science` vs stream as a separate column | Phase 1 |
| 4 | Who gets `admin` vs `office` role — specifically, can Komal Mam approve into master? | Phase 3 |
| 5 | Optional PIN on by default, or only for Aadhaar collection? | Phase 3 |
| 6 | Subdomain: `data.veerpatta.in` or something teacher-friendlier and shorter | Phase 0 |
| 7 | Max marks per FA subject — 25 assumed, confirm against LEAD's pattern | Phase 4 |

---

## 14. Codex / Claude Code prompts

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
