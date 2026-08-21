-- Collabify — is this class going to finish, and who is carrying it.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/analytics.sql

/**
 * Views only. Everything here was already in the database; nothing about a
 * class was being added up.
 *
 * The projection is arithmetic and says so on screen. There is one class, one
 * work-log row and four graded results in this database — a trained model would
 * produce a confident number with nothing behind it, and would have to be
 * thrown away the moment real history existed. Dividing weeks covered by weeks
 * elapsed is honest, useful today, and still correct in three years.
 *
 * `security_invoker = true` throughout, and every view is scoped to the class's
 * own professor.
 *
 * That scope is not belt-and-braces. `class_gaps` and `class_pace` both count
 * what is *absent*, and a student cannot see an unreleased project — so without
 * it a student would read a gap list of weeks their professor had in fact
 * already set. A negative measurement is only true for somebody who can see
 * everything it is measuring.
 */

begin;

-- ---------------------------------------------------------------- pace

/**
 * Weeks covered against weeks elapsed, and where that lands.
 *
 * A week counts as covered when a live project spans it — the syllabus is the
 * plan, and a project bound to those weeks is the evidence it happened.
 */
drop view if exists public.class_pace;

create view public.class_pace
with (security_invoker = true) as
with covered as (
  select p.class_id, g.week_no
    from public.projects p
    cross join lateral generate_series(p.start_week, p.end_week) as g(week_no)
   where p.archived_at is null
   group by 1, 2
)
select c.id as class_id,
       c.initial as class_initial,
       c.name as class_name,
       c.term_start,
       c.term_end,
       (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id)::int
         as weeks_total,
       (select count(*) from covered v where v.class_id = c.id)::int as weeks_covered,
       -- Never zero: dividing by it is the whole point, and a term that started
       -- today has had one week of chances, not none.
       -- term_start and term_end are dates, so subtraction is whole days.
       greatest(1, ((current_date - c.term_start) / 7))::int as weeks_elapsed,
       -- The whole term, so "will it fit" has something to be measured against.
       greatest(1, ceil((c.term_end - c.term_start) / 7.0)::int) as weeks_in_term
  from public.classes c
 where c.archived_at is null
   and c.term_start is not null
   and c.term_end is not null
   and public.is_class_professor(c.id);

grant select on public.class_pace to authenticated;

-- ---------------------------------------------------------------- gaps

/**
 * A syllabus week that names something to hand in, with nothing set against it.
 *
 * The most useful thing on the page and the least clever: no projection, no
 * threshold. The syllabus said Lab 6 happens in week 11; nothing does.
 */
drop view if exists public.class_gaps;

create view public.class_gaps
with (security_invoker = true) as
select c.id   as class_id,
       c.initial as class_initial,
       c.name  as class_name,
       w.week_no,
       w.title as week_title,
       w.assessments,
       (c.term_start + ((w.week_no - 1) * 7))::date as week_start,
       case
         when c.term_start is null then 'undated'
         when current_date >  (c.term_start + ((w.week_no - 1) * 7) + 6) then 'past'
         when current_date >= (c.term_start + ((w.week_no - 1) * 7))     then 'current'
         else 'upcoming'
       end as phase
  from public.classes c
  join public.syllabus_weeks w on w.resource_id = c.syllabus_id
 where c.archived_at is null
   and public.is_class_professor(c.id)
   and btrim(w.assessments) <> ''
   and not exists (
     select 1 from public.projects p
      where p.class_id = c.id
        and p.archived_at is null
        and w.week_no between p.start_week and p.end_week
   );

grant select on public.class_gaps to authenticated;

-- ---------------------------------------------------------------- health

/** Where the work of a class actually stands, counted once. */
drop view if exists public.class_health;

create view public.class_health
with (security_invoker = true) as
select c.id as class_id,
       c.initial as class_initial,
       c.name as class_name,
       count(b.*)::int                                                as boards,
       count(b.*) filter (where b.task_count = 0)::int                as boards_empty,
       count(b.*) filter (where b.submitted_at is not null)::int      as boards_submitted,
       count(b.*) filter (where b.result_verdict = 'accepted')::int   as boards_accepted,
       count(b.*) filter (where b.result_verdict = 'returned')::int   as boards_returned,
       coalesce(sum(b.late_count), 0)::int                            as late_tasks,
       coalesce(sum(b.task_count), 0)::int                            as tasks,
       coalesce(sum(b.done_count), 0)::int                            as tasks_done,
       coalesce(sum(b.unclaimed_count), 0)::int                       as tasks_unclaimed,
       case when count(b.*) = 0 then 0
            else round(avg(b.done_pct), 1) end                        as average_done_pct,
       max(b.last_activity)                                           as last_activity
  from public.classes c
  left join public.task_board_overview b on b.class_id = c.id
 where c.archived_at is null
   and public.is_class_professor(c.id)
 group by c.id, c.initial, c.name;

grant select on public.class_health to authenticated;

-- ---------------------------------------------------------------- load

/**
 * Who is carrying what, by name, across a whole class.
 *
 * Effort only — held, finished, and their share. No verdict and no feedback:
 * this answers who is doing the work, not who is doing well, and the two
 * deserve separate pages.
 *
 * Group boards only. On an individual project everyone holds their own hundred
 * per cent, so "who is carrying this alone" has no meaning.
 */
drop view if exists public.class_member_load;

create view public.class_member_load
with (security_invoker = true) as
select b.class_id,
       b.project_id,
       b.id           as board_id,
       b.group_name,
       b.project_title,
       m.student_id,
       btrim(p.first_name || ' ' || p.last_name) as student_name,
       p.avatar_url,
       m.task_count,
       m.done_count,
       m.held_pct,
       m.personal_pct,
       (select count(*) from public.group_members gm where gm.group_id = b.group_id)::int
         as group_size,
       -- When this person's own work began and last moved, so their rate is
       -- measured from when they started rather than when the board did.
       (select min(t.started_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = b.id and a.student_id = m.student_id) as first_activity,
       (select max(t.done_at) from public.project_tasks t
          join public.task_assignees a on a.task_id = t.id
         where t.board_id = b.id and a.student_id = m.student_id) as last_finish
  from public.task_board_overview b
  join public.task_member_progress m on m.board_id = b.id
  join public.profiles p on p.id = m.student_id
 where b.group_id is not null
   and public.is_class_professor(b.class_id);

grant select on public.class_member_load to authenticated;

-- ---------------------------------------------------------------- burn

/**
 * The same question as the syllabus pace, one level down: at the rate this
 * board is finishing tasks, does the remaining work fit before the deadline.
 *
 * Measured from when the board actually started, not when the project was set.
 * A group that sat idle for two weeks and then began in earnest is moving at
 * the rate they are moving now, and dating it from the project would report a
 * rate nobody has.
 *
 * The raw numbers only. The division happens in one place in `types.ts`, shared
 * with the pace card, so the two projections can never drift apart.
 */
drop view if exists public.board_burn;

create view public.board_burn
with (security_invoker = true) as
select b.id             as board_id,
       b.class_id,
       b.project_id,
       b.project_title,
       b.group_id,
       b.group_name,
       b.student_name,
       b.project_due_at,
       b.submitted_at,
       b.result_verdict,
       b.task_count,
       b.done_count,
       b.unclaimed_count,
       b.late_count,
       b.done_pct,
       b.member_count,
       t.first_activity,
       t.last_finish,
       -- Whole days, never zero: a board that started this morning has had a
       -- day of chances, not none, and it is about to be divided by.
       case when t.first_activity is null then null
            else greatest(1, (current_date - t.first_activity::date))::int end as days_active,
       case when b.project_due_at is null then null
            else (b.project_due_at::date - current_date)::int end as days_left
  from public.task_board_overview b
  cross join lateral (
    select min(x.started_at) as first_activity, max(x.done_at) as last_finish
      from public.project_tasks x where x.board_id = b.id
  ) t
 where public.is_class_professor(b.class_id);

grant select on public.board_burn to authenticated;

-- ---------------------------------------------------------------- tasks

/**
 * The leaf of the filter. One task, and enough around it to say whether it is
 * in trouble — nothing is projected for a single task, because a task is done
 * or it is not.
 *
 * `assignee_ids` travels as an array so the page can narrow to one student
 * without a second round trip.
 */
drop view if exists public.task_state;

create view public.task_state
with (security_invoker = true) as
select t.id            as task_id,
       t.title,
       t.status,
       t.due_at,
       t.late,
       t.weight,
       t.started_at,
       t.done_at,
       b.id            as board_id,
       b.class_id,
       b.project_id,
       b.project_title,
       b.group_id,
       b.group_name,
       b.student_name  as board_student_name,
       coalesce(
         (select array_agg(a.student_id) from public.task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       coalesce(
         (select string_agg(btrim(p.first_name || ' ' || p.last_name), ', ')
            from public.task_assignees a
            join public.profiles p on p.id = a.student_id
           where a.task_id = t.id),
         ''
       ) as assignee_names
  from public.project_tasks t
  join public.task_board_overview b on b.id = t.board_id
 where public.is_class_professor(b.class_id);

grant select on public.task_state to authenticated;

commit;
