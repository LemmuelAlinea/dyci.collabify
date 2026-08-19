-- Collabify — every dated thing in one place.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/calendar.sql

/**
 * A calendar of what is actually planned, assembled from what already exists —
 * no new tables, no new columns.
 *
 * `security_invoker = true` does the role scoping for nothing: a student's own
 * policies already hide unreleased projects and other groups' boards, so those
 * rows simply do not come back for them. Nothing about a role is written into
 * this view, which is why it cannot drift out of step with the policies.
 *
 * Deliberately absent: polls.closed_at and group_sets.closed_at record when a
 * thing *was* closed, the way locked_at does. They are state, not scheduled
 * deadlines, and putting them here would imply a future date that does not
 * exist. Task events and work-log entries are history, and history belongs in
 * the activity feed — a calendar is for what you plan around.
 */

begin;

drop view if exists public.calendar_events;

create view public.calendar_events
with (security_invoker = true) as

-- What the whole project is due by.
select 'project_due'          as kind,
       p.id                   as ref_id,
       p.title                as title,
       p.due_at               as at,
       p.class_id,
       c.initial              as class_initial,
       c.name                 as class_name,
       p.id                   as project_id,
       p.title                as project_title,
       null::uuid             as task_id,
       null::text             as group_name,
       false                  as done,
       false                  as late
  from public.projects p
  join public.classes c on c.id = p.class_id
 where p.due_at is not null
   and p.archived_at is null

union all

-- When a scheduled project reaches the students. Students cannot see a project
-- before it is live, so these rows are the professor's alone without a word
-- here saying so.
select 'project_release',
       p.id,
       p.title,
       p.release_at,
       p.class_id,
       c.initial,
       c.name,
       p.id,
       p.title,
       null::uuid,
       null::text,
       false,
       false
  from public.projects p
  join public.classes c on c.id = p.class_id
 where p.release_at is not null
   and p.archived_at is null

union all

-- One task's own deadline. A professor's calendar leaves these out — a class of
-- sixteen carrying nine each is a hundred and forty-four chips in one month,
-- and none of them are theirs to act on — but that is a choice the query makes,
-- not a rule this view enforces.
select 'task_due',
       t.id,
       t.title,
       t.due_at,
       p.class_id,
       c.initial,
       c.name,
       p.id,
       p.title,
       t.id,
       g.name,
       t.status = 'done',
       t.late
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
  join public.projects p on p.id = b.project_id
  join public.classes c on c.id = p.class_id
  left join public.groups g on g.id = b.group_id
 where t.due_at is not null
   and p.archived_at is null

union all

-- The moment a board was handed in. Past tense, and the point of showing it is
-- where it sits against the deadline above.
select 'submitted',
       b.id,
       coalesce(g.name, btrim(sp.first_name || ' ' || sp.last_name), 'A student'),
       b.submitted_at,
       p.class_id,
       c.initial,
       c.name,
       p.id,
       p.title,
       null::uuid,
       g.name,
       true,
       false
  from public.project_boards b
  join public.projects p on p.id = b.project_id
  join public.classes c on c.id = p.class_id
  left join public.groups g on g.id = b.group_id
  left join public.profiles sp on sp.id = b.student_id
 where b.submitted_at is not null
   and p.archived_at is null;

grant select on public.calendar_events to authenticated;

commit;
