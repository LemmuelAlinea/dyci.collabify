-- Collabify — dashboards. One column: when a board last moved.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/dashboard.sql

begin;

/**
 * `task_board_overview` used to be redefined here, and that was a bug.
 *
 * Four files created it — tasks.sql, task-points.sql, results.sql and this one
 * — and this file runs last, so this copy won. It was also the oldest: it was
 * missing `submitted_at`, `submitted_by`, `submitted_by_name`,
 * `project_locked_at`, `student_name`, `result_verdict`, `result_at`,
 * `late_count` and `last_activity`, every one of which results.sql adds and
 * the analytics, insight and report views read.
 *
 * The live database never showed it, because results.sql happened to be the
 * last of the four actually run against it. Rebuilding from the documented
 * order would have produced a database the app could not query — which is the
 * thing docs/07-backup.md promises it can do.
 *
 * results.sql owns the view now, and this file only uses it. The column it was
 * added here for, `last_activity`, is in that definition.
 */

-- The dashboard reads announcements across every class at once.
create index if not exists announcements_recent_idx
  on public.announcements (class_id, pinned desc, created_at desc);

commit;
