-- Collabify — what the program chair may see of the program.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/admin-program.sql
--
-- Reads task_board_overview, which its owners drop with `cascade`. After
-- re-running results.sql, tasks.sql, task-points.sql, task-claim-limit.sql or
-- deadline-lock.sql, rebuild the chain:
--
--   node scripts/db.mjs supabase/results.sql supabase/analytics.sql \
--     supabase/analytics-insight.sql supabase/reports.sql \
--     supabase/student-reports.sql supabase/admin-program.sql

/**
 * The admin of this product is the BSIT program chair: a non-teaching academic
 * head. Their duties, as Philippine faculty manuals name them, begin with
 * making sure each course's syllabus is implemented within the term, and
 * include assigning teaching load and watching a cohort's progress.
 *
 * **Counts, never content.** Until now an admin read accounts and classes and
 * nothing academic at all — no project, task, comment, file, message,
 * submission or verdict — and the audit log's design leans on that. This widens
 * the wall by exactly one step: class-level figures. Whether a class has term
 * dates and a syllabus, how many of its weeks have work against them, how many
 * students it holds, how much of its work is finished and how much was late.
 *
 * Nothing here is a title, a body, a filename, a person's work or a mark. The
 * suite asserts the column list exactly, so a content column cannot arrive
 * quietly under a plausible name.
 *
 * It is a new view rather than a widened `report_class_summary` for the reason
 * the student views were also new: that one is gated by `is_class_professor`,
 * and its siblings carry names against work. Letting the admin in there would
 * leave a single predicate between the program office and every student's
 * tasks. A view cannot leak what it never selects.
 *
 * ---------------------------------------------------------------------------
 * **This is the one view in the database that is not `security_invoker`, and
 * the reason is the wall itself.**
 *
 * Every other view runs as its caller, so the caller's own policies decide what
 * it returns. An admin has no policy on `class_members`, `projects`,
 * `syllabus_weeks` or `task_board_overview` — that is deliberate and it is what
 * keeps academic content away from the program office. Read as the caller, this
 * view therefore counted zero students, zero projects and zero tasks for a
 * class holding sixteen, three and twenty-six.
 *
 * There were two ways to fix it. Give the admin select policies on those tables
 * — which hands them every row of every task and comment, the exact thing being
 * prevented. Or let this one view count them on the admin's behalf while the
 * tables stay shut. The second is far narrower: the admin still cannot select
 * from a single academic table, and the only thing that crosses the wall is a
 * set of integers this view chose.
 *
 * What holds it up, and what must not be weakened:
 *
 *   - `where public.is_admin()` is the whole gate. Without it this view would
 *     return every class to everybody, so the suite reads it as a professor and
 *     as a student and requires zero rows from both.
 *   - `security_barrier` keeps that gate from being outrun by a cheaper
 *     function in somebody's own WHERE clause.
 *   - The select list is counts, names of classes and professors, and dates.
 *     Adding a column that carries content would defeat all of the above, so
 *     the suite pins the column list exactly.
 */

begin;

drop view if exists public.admin_class_overview;

create view public.admin_class_overview
with (security_barrier = true) as
select c.id                                       as class_id,
       c.initial                                  as class_initial,
       c.name                                     as class_name,
       c.code,
       c.section,
       c.year_level,
       c.semester,
       c.school_year,
       c.professor_id,
       btrim(p.first_name || ' ' || p.last_name)  as professor_name,
       c.term_start,
       c.term_end,
       -- A finished term is still the chair's to review, so an archived class
       -- stays listed and says when it ended.
       c.archived_at,
       (w.weeks_total > 0)                        as has_syllabus,
       w.weeks_total,
       w.weeks_covered,
       -- Counted exactly as class_pace counts them, so a row from this view
       -- satisfies the ClassPace shape and the page reuses projectFinish rather
       -- than growing a second copy of the same division.
       case when c.term_start is null then null
            else greatest(1, ((current_date - c.term_start) / 7))::int end as weeks_elapsed,
       case when c.term_start is null or c.term_end is null then null
            else greatest(1, ceil((c.term_end - c.term_start) / 7.0)::int) end as weeks_in_term,
       m.students,
       pr.projects,
       pr.projects_released,
       b.boards,
       b.tasks,
       b.tasks_done,
       b.tasks_late,
       b.last_activity
  from public.classes c
  join public.profiles p on p.id = c.professor_id
  cross join lateral (
    select count(*) filter (where cm.status = 'active')::int as students
      from public.class_members cm
     where cm.class_id = c.id
  ) m
  cross join lateral (
    select count(*)::int as projects,
           count(*) filter (
             where x.release_at is null or x.release_at <= now()
           )::int as projects_released
      from public.projects x
     where x.class_id = c.id and x.archived_at is null
  ) pr
  cross join lateral (
    -- Counted off the base tables rather than task_board_overview. That view is
    -- `security_invoker`, and an invoker view keeps using the *session's* user
    -- even when it is read from inside a view that is not — so through it the
    -- admin's own (absent) policies applied and every board counted zero.
    select count(distinct bd.id)::int                                  as boards,
           count(t.id)::int                                            as tasks,
           count(t.id) filter (where t.status = 'done')::int           as tasks_done,
           count(t.id) filter (where t.status = 'done' and t.late)::int as tasks_late,
           max(t.updated_at)                                           as last_activity
      from public.project_boards bd
      join public.projects x on x.id = bd.project_id
      left join public.project_tasks t on t.board_id = bd.id
     where x.class_id = c.id
  ) b
  cross join lateral (
    select (select count(*) from public.syllabus_weeks sw
             where sw.resource_id = c.syllabus_id)::int as weeks_total,
           (select count(distinct g.week_no)
              from public.projects x
              cross join lateral generate_series(x.start_week, x.end_week) as g(week_no)
             where x.class_id = c.id and x.archived_at is null)::int as weeks_covered
  ) w
 where public.is_admin();

-- Signed-in callers only, and of those only an admin gets a row.
revoke all on public.admin_class_overview from anon;
grant select on public.admin_class_overview to authenticated;

commit;
