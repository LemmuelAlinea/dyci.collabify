-- Collabify — the record a student can keep of their own work.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/student-reports.sql
--
-- Depends on task_board_overview and task_member_progress, which their owners
-- drop with `cascade`. After re-running results.sql, tasks.sql, task-points.sql,
-- task-claim-limit.sql or deadline-lock.sql, rebuild the whole chain:
--
--   node scripts/db.mjs supabase/results.sql supabase/analytics.sql \
--     supabase/analytics-insight.sql supabase/reports.sql \
--     supabase/student-reports.sql

/**
 * The professor's reports answer for a whole class. These answer for one
 * person, and they are deliberately their own views rather than a widening of
 * the professor's.
 *
 * `report_student_work` is gated by `is_class_professor` and holds every
 * student in the class. Loosening that gate to let students in would have meant
 * one predicate standing between a student and the whole cohort's effort — the
 * kind of clause that is correct the day it is written and wrong after the next
 * edit. Narrow views cannot leak what they never select.
 *
 * What a student may see here, and why:
 *
 *   - **Their own work**, everywhere. Nobody else's, in any class.
 *   - **The board they are on**: its tasks, who holds each one, and each
 *     member's share. This is the same information their task board already
 *     shows them — the claims are on the cards — only added up. A group can see
 *     how its own work was split; that is what the group is.
 *   - **Nothing of any other group**, and nothing class-wide. No analytics, no
 *     diagnosis, no other board's tasks.
 *
 * As with every report: no grade. Collabify records none.
 */

begin;

-- ------------------------------------------------------------- my own work

/**
 * One row per board this student is on, with what they held on it.
 *
 * Scoped twice on purpose: `auth.uid()` picks their own progress row, and
 * `task_board_overview` is security_invoker, so their own policies decide which
 * boards exist at all.
 */
drop view if exists public.my_work_report;

create view public.my_work_report
with (security_invoker = true) as
select o.class_id,
       c.initial     as class_initial,
       c.name        as class_name,
       c.code,
       c.section,
       c.semester,
       c.school_year,
       o.project_id,
       o.project_title,
       o.project_due_at,
       o.id          as board_id,
       o.group_name,
       o.student_name as board_student_name,
       o.submitted_at,
       o.result_verdict,
       o.result_at,
       o.task_count  as board_tasks,
       o.done_count  as board_done,
       m.task_count  as tasks_held,
       m.done_count  as tasks_done,
       m.late_count  as tasks_late,
       m.held_pct,
       m.personal_pct,
       (select min(t.started_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = o.id and a.student_id = m.student_id) as first_activity,
       (select max(t.done_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = o.id and a.student_id = m.student_id) as last_finish
  from public.task_board_overview o
  join public.task_member_progress m
    on m.board_id = o.id and m.student_id = auth.uid()
  join public.classes c on c.id = o.class_id;

grant select on public.my_work_report to authenticated;

-- ---------------------------------------------------------- my group's work

/** Every task on a board this student is on, with who holds it. */
drop view if exists public.my_board_tasks;

create view public.my_board_tasks
with (security_invoker = true) as
select t.id        as task_id,
       t.board_id,
       o.class_id,
       o.project_id,
       o.project_title,
       coalesce(o.group_name, o.student_name) as board_owner,
       t.title,
       t.weight,
       t.status,
       t.author_role,
       t.due_at,
       t.started_at,
       t.done_at,
       t.late,
       t.position,
       coalesce(
         (select string_agg(btrim(p.first_name || ' ' || p.last_name), ', '
                   order by btrim(p.first_name || ' ' || p.last_name))
            from public.task_assignees a
            join public.profiles p on p.id = a.student_id
           where a.task_id = t.id),
         ''
       ) as holders,
       (select count(*) from public.task_files f where f.task_id = t.id)::int as file_count
  from public.project_tasks t
  join public.task_board_overview o on o.id = t.board_id
 where public.is_board_member(t.board_id);

grant select on public.my_board_tasks to authenticated;

/**
 * How the board's work was split, member by member.
 *
 * Only for a board this student is on. The same numbers the board itself makes
 * visible — every claim is on a card there — gathered into one line each.
 */
drop view if exists public.my_board_members;

create view public.my_board_members
with (security_invoker = true) as
select m.board_id,
       m.student_id,
       btrim(p.first_name || ' ' || p.last_name) as student_name,
       p.avatar_url,
       m.task_count as tasks_held,
       m.done_count as tasks_done,
       m.late_count as tasks_late,
       m.held_pct,
       m.personal_pct,
       (m.student_id = auth.uid()) as is_me
  from public.task_member_progress m
  join public.profiles p on p.id = m.student_id
 where public.is_board_member(m.board_id);

grant select on public.my_board_members to authenticated;

commit;
