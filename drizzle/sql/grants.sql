-- ============================================================================
-- Append-only enforcement and least privilege for the application role.
-- SAMPARK_BUILD_PLAN.md section 4.2 and 4.3.
-- ============================================================================
--
-- Migrations run as the Neon owner role (neondb_owner) over the UNPOOLED
-- connection. The application runs as `app_rw` over the pooled connection and
-- has no DDL rights at all.
--
-- Rule 4 of the standing rules: `submissions` and `change_log` are append-only,
-- and that is enforced HERE, by database grants, not by application discipline.
-- The app role gets INSERT and SELECT on both, plus UPDATE on exactly one
-- column: submissions.review_status.
--
-- RE-RUN THIS AFTER EVERY MIGRATION.  `npm run db:grants`
--
-- Deliberately no ALTER DEFAULT PRIVILEGES. Blanket default privileges would
-- silently hand app_rw full UPDATE and DELETE on any table a future migration
-- creates — including a recreated `submissions`. Re-running this file is
-- boring; a silently writable audit log is not.
--
-- This file is idempotent and safe to run repeatedly. It does not create the
-- role: that needs a password, and passwords do not belong in a public repo.
-- `npm run db:grants` creates the role on first run.

GRANT USAGE ON SCHEMA public TO app_rw;

-- ---------------------------------------------------------------- read/write
GRANT SELECT, INSERT, UPDATE, DELETE ON
  students, requests, request_students, request_batches, student_records,
  teachers, teacher_subjects, users, field_defs, rate_limits,
  value_sources
TO app_rw;

-- `sources` and `field_sources` are precedence POLICY, not data the app
-- collects. Which source outranks which for a given field is an administrative
-- decision that arrives through a migration or a seed run as the owner — an
-- import must never be able to promote its own source mid-run and thereby win
-- an argument it should have lost.
GRANT SELECT ON sources, field_sources TO app_rw;

-- --------------------------------------------------------------- append-only
GRANT SELECT, INSERT ON submissions, change_log TO app_rw;

-- change_log is written once and never touched again.
--
-- A row with a NULL submission_id is not a broken row: it is the office editing
-- a student directly on /students/[id], where there is no submission because
-- nobody proposed anything. Its `decision` reads 'edited'. Still append-only,
-- still INSERT and SELECT only, and the grants below are what make that true
-- rather than the application remembering to behave.
REVOKE UPDATE, DELETE ON change_log FROM app_rw;

-- submissions.review_status is the sole updatable column anywhere in the audit
-- path. Revoke the whole table first, then grant back the single column —
-- order matters, a column grant does not narrow an existing table grant.
REVOKE UPDATE ON submissions FROM app_rw;
GRANT UPDATE (review_status) ON submissions TO app_rw;
REVOKE DELETE ON submissions FROM app_rw;

-- ----------------------------------------------------------------- sequences
-- BIGSERIAL primary keys on change_log and student_records need their sequence.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

-- --------------------------------------------------------------------- views
--
-- request_progress IS GONE, AND PLAN SECTION 4.3 IS NOT BEING FOLLOWED.
--
-- The plan proposed a view the status board would read instead of assembling
-- correlated counts in application code. It was created, granted, and never
-- read by one line of the app — and in the time it sat there unread it drifted
-- into disagreeing with the board on both of the numbers it existed to supply:
--
--   students_answered  counted count(DISTINCT student_id), i.e. "has any
--                      submission". The board counts students answered for on
--                      EVERY field the request asked about, because a card with
--                      one of two boxes filled is not a child who is done. See
--                      src/lib/answered.ts.
--   changes_pending    restricted to action = 'changed'. The board counts every
--                      pending row, so a not_present awaiting review shows on
--                      one and not the other.
--
-- A view nothing reads cannot be caught by a test or a screen, so it drifts
-- silently and is then trusted by whoever finds it first. Three small aggregates
-- in Drizzle are already what listRequests does, and they are the definition
-- everything else agrees with. Dropped rather than corrected: the argument for
-- deleting it is exactly that nothing reads it, and correcting it would leave
-- that true.
--
-- DROP rather than silence, because grants.sql is re-run on every branch and an
-- abandoned view would otherwise outlive this note on databases that already
-- have it.
DROP VIEW IF EXISTS request_progress;
