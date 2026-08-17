-- Syllabus weeks: capture the assessment/evidence column.
--
-- A syllabus week names what it expects to be handed in — "Project Milestone 2",
-- "Lab 6", "Final project bundle and defense". That is what a project binds to,
-- so it needs its own column rather than being folded into topics.
--
-- Idempotent. Run with:  node scripts/db.mjs supabase/syllabus-assessments.sql

begin;

alter table public.syllabus_weeks
  add column if not exists assessments text not null default '';

commit;
