-- Collabify — the record a professor hands to somebody else.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/reports.sql
--
-- Depends on task_board_overview, which its owners drop with `cascade`. After
-- re-running results.sql, tasks.sql, task-points.sql, task-claim-limit.sql or
-- deadline-lock.sql, rebuild the chain in one command:
--
--   node scripts/db.mjs supabase/results.sql supabase/analytics.sql \
--     supabase/analytics-insight.sql supabase/reports.sql

/**
 * Analytics answers what is happening now, on screen, for the professor alone.
 * These views answer a different question: what will be printed and handed to a
 * chair, kept in a course file, or typed into a class record.
 *
 * Three rules hold them apart from the analytics views:
 *
 *   1. **Archived classes and projects stay in.** Every analytics view drops
 *      them, because a finished term is not work to chase. A term report is
 *      exactly for the term that just ended, so hiding it would empty the one
 *      report anybody actually asks for. The archive date travels with the row
 *      and the sheet prints "term ended" beside it.
 *
 *   2. **No grade, no score, no mark.** Collabify records none, and a report is
 *      precisely where a completion percentage would start being read as one.
 *      `total_points` and `project_criteria` stay out. The suite asserts no
 *      column here is named anything a mark could hide behind.
 *
 *   3. Scoped by `is_class_professor`, `security_invoker = true`, like every
 *      other view in this database.
 */

begin;

-- --------------------------------------------------------------- the class

/**
 * One row per class the professor owns, archived included: enrolment, what was
 * run in it, and how much of it finished. Feeds the term report and the
 * across-classes summary.
 */
drop view if exists public.report_class_summary;

create view public.report_class_summary
with (security_invoker = true) as
select c.id            as class_id,
       c.initial       as class_initial,
       c.name          as class_name,
       c.code,
       c.section,
       c.school_year,
       c.semester,
       c.year_level,
       c.term_start,
       c.term_end,
       c.archived_at,
       m.students,
       m.students_removed,
       p.projects,
       p.projects_archived,
       b.boards,
       b.boards_submitted,
       b.boards_accepted,
       b.boards_returned,
       b.tasks,
       b.tasks_done,
       b.tasks_late,
       b.tasks_unclaimed,
       w.weeks_total,
       w.weeks_covered
  from public.classes c
  cross join lateral (
    select count(*) filter (where cm.status = 'active')::int  as students,
           count(*) filter (where cm.status <> 'active')::int as students_removed
      from public.class_members cm
     where cm.class_id = c.id
  ) m
  cross join lateral (
    select count(*)::int                                        as projects,
           count(*) filter (where pr.archived_at is not null)::int as projects_archived
      from public.projects pr
     where pr.class_id = c.id
  ) p
  cross join lateral (
    select count(*)::int                                              as boards,
           count(*) filter (where o.submitted_at is not null)::int    as boards_submitted,
           count(*) filter (where o.result_verdict = 'accepted')::int as boards_accepted,
           count(*) filter (where o.result_verdict = 'returned')::int as boards_returned,
           coalesce(sum(o.task_count), 0)::int                        as tasks,
           coalesce(sum(o.done_count), 0)::int                        as tasks_done,
           coalesce(sum(o.late_count), 0)::int                        as tasks_late,
           coalesce(sum(o.unclaimed_count), 0)::int                   as tasks_unclaimed
      from public.task_board_overview o
     where o.class_id = c.id
  ) b
  cross join lateral (
    select (select count(*) from public.syllabus_weeks sw
             where sw.resource_id = c.syllabus_id)::int as weeks_total,
           (select count(distinct g.week_no)
              from public.projects pr
              cross join lateral generate_series(pr.start_week, pr.end_week) as g(week_no)
             where pr.class_id = c.id)::int             as weeks_covered
  ) w
 where public.is_class_professor(c.id);

grant select on public.report_class_summary to authenticated;

-- ------------------------------------------------------------- the syllabus

/**
 * Week by week: what the syllabus asked for, and what was actually set against
 * it. The course-file sheet.
 *
 * A week with an assessment named and `project_count = 0` is the gap an
 * accreditor asks about, and it is the same measurement `class_gaps` makes —
 * except this one keeps archived classes, and lists every week rather than only
 * the empty ones, because a coverage report has to show what was covered too.
 */
drop view if exists public.report_week_coverage;

create view public.report_week_coverage
with (security_invoker = true) as
select w.class_id,
       w.week_no,
       w.title,
       w.topics,
       w.outcomes,
       w.assessments,
       w.week_start,
       w.week_end,
       w.phase,
       coalesce(p.titles, '')  as project_titles,
       coalesce(p.n, 0)::int   as project_count
  from public.class_week_map w
  left join lateral (
    select string_agg(pr.title, ', ' order by pr.start_week, pr.title) as titles,
           count(*) as n
      from public.projects pr
     where pr.class_id = w.class_id
       and w.week_no between pr.start_week and pr.end_week
  ) p on true
 where public.is_class_professor(w.class_id);

grant select on public.report_week_coverage to authenticated;

-- -------------------------------------------------------------- the student

/**
 * One row per student per project, on group and individual boards alike.
 *
 * `class_member_load` cannot serve this: it drops individual boards, because
 * "who is carrying this alone" has no meaning when everybody owns their own
 * hundred per cent. A contribution report has the opposite need — the solo work
 * is half of what the student did.
 *
 * Effort only. What they held, what they finished, how much of the board that
 * was, and when they last moved. No mark, and the board's verdict travels
 * beside it as the professor's own answer rather than a score.
 */
drop view if exists public.report_student_work;

create view public.report_student_work
with (security_invoker = true) as
select o.class_id,
       o.project_id,
       o.project_title,
       o.id            as board_id,
       o.group_name,
       o.student_name  as board_student_name,
       o.submitted_at,
       o.result_verdict,
       o.project_due_at,
       m.student_id,
       btrim(pr.first_name || ' ' || pr.last_name) as student_name,
       pr.avatar_url,
       m.task_count    as tasks_held,
       m.done_count    as tasks_done,
       m.late_count    as tasks_late,
       m.held_pct,
       m.personal_pct,
       (select min(t.started_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = o.id and a.student_id = m.student_id) as first_activity,
       (select max(t.done_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = o.id and a.student_id = m.student_id) as last_finish
  from public.task_board_overview o
  join public.task_member_progress m on m.board_id = o.id
  join public.profiles pr on pr.id = m.student_id
 where public.is_class_professor(o.class_id);

grant select on public.report_student_work to authenticated;

-- ---------------------------------------------------------------- the board

/**
 * Every task on one board, with who held it and when it moved. The body of the
 * group project report, and the only place a professor sees the whole of a
 * group's work on one page.
 */
drop view if exists public.report_board_tasks;

create view public.report_board_tasks
with (security_invoker = true) as
select t.id          as task_id,
       t.board_id,
       o.class_id,
       o.project_id,
       o.project_title,
       coalesce(o.group_name, o.student_name) as board_owner,
       t.title,
       t.details,
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
 where public.is_class_professor(o.class_id);

grant select on public.report_board_tasks to authenticated;

commit;
