-- Collabify — what realtime is allowed to broadcast.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/live.sql

/**
 * Every page keeps itself current instead of asking somebody to press reload.
 * Four things do that (see src/hooks/useLive.ts); this file is what the first
 * of them needs — a table cannot be subscribed to unless it is in the
 * `supabase_realtime` publication.
 *
 * Adding a table here does not widen who can see what. Realtime evaluates the
 * same row-level policies the client would: a student subscribed to `classes`
 * is told only about classes `classes_select` would already have handed them.
 * The publication decides what is *broadcast at all*, not who receives it.
 *
 * `replica identity full` is set alongside, and it is not optional. With the
 * default identity an UPDATE or DELETE event carries the primary key and
 * nothing else, so realtime has no columns to evaluate a policy against and
 * drops the event for any RLS-protected table. That is why a deleted row used
 * to vanish for the person who deleted it and stay on everybody else's screen
 * until they reloaded.
 *
 * Deliberately not here:
 *
 *   audit_log        Append-only and read by one page, which polls. Streaming
 *                    every privileged action to every listening client is a
 *                    larger surface than the feature is worth.
 *   task_worklog     High volume, and the board it belongs to already
 *                    broadcasts through project_tasks.
 */

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    -- teaching
    'classes', 'class_members', 'projects', 'project_boards', 'board_results',
    'announcements', 'announcement_attachments',
    -- groups
    'group_sets', 'groups', 'group_members',
    -- work
    'task_reassignments', 'task_events',
    -- syllabus and the shelf
    'teaching_resources', 'syllabus_weeks',
    -- the program office
    'program_announcements', 'program_sections',
    -- people
    'profiles', 'notifications'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_table then
        raise notice 'skipped %, no such table', t;
    end;

    begin
      execute format('alter table public.%I replica identity full', t);
    exception
      when undefined_table then null;
    end;
  end loop;
end $$;

commit;
