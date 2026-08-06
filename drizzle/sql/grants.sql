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
  students, requests, request_students, student_records,
  teachers, users, field_defs, rate_limits,
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
-- Section 4.3. The request status board reads this instead of assembling four
-- correlated counts in application code.
CREATE OR REPLACE VIEW request_progress AS
SELECT r.id,
       r.title,
       r.class_label,
       t.name AS teacher,
       r.due_date,
       r.status,
       (SELECT count(*) FROM request_students rs
         WHERE rs.request_id = r.id)                        AS roster_size,
       (SELECT count(DISTINCT s.student_id) FROM submissions s
         WHERE s.request_id = r.id)                         AS students_answered,
       (SELECT count(*) FROM submissions s
         WHERE s.request_id = r.id
           AND s.review_status = 'pending'
           AND s.action = 'changed')                        AS changes_pending
FROM requests r
JOIN teachers t ON t.id = r.teacher_id;

GRANT SELECT ON request_progress TO app_rw;
