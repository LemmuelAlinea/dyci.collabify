-- Collabify — moving a term's weeks after a disruption.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/term-shifts.sql
--
-- Depends on `class_week_shifts` and the shift-aware `class_week_map`, both in
-- syllabus.sql. Run that first.

/**
 * A typhoon closed the school for a week and every week from the midterm
 * onward moved. `class_week_shifts` records that; these three functions are
 * how a professor writes one and deals with what it leaves behind.
 *
 * The order matters and is deliberate:
 *
 *   1. `shift_class_weeks`      the weeks move
 *   2. `class_shift_impact`     what deadlines that stranded
 *   3. `apply_shift_to_deadlines` the ones the professor chose to move
 *
 * Deadlines are not moved automatically. `projects.due_at` and
 * `project_tasks.due_at` are real dates a professor set, sometimes fixed by
 * the department rather than by the syllabus, and silently rewriting a date
 * students have already planned around is worse than the drift it fixes. So
 * the middle step exists: here is what no longer lines up, tick what should
 * follow the term.
 */

-- A new enum value cannot be used in the transaction that added it.
begin;

do $$
begin
  alter type public.notification_type add value if not exists 'term_shifted';
end $$;

commit;

begin;

-- ------------------------------------------------------------ moving weeks

/**
 * Move week `p_from_week` and everything after it by `p_days`.
 *
 * Takes days rather than a target date on purpose. The professor picks a date
 * in the form and the client turns it into a delta, because the sibling class
 * that shares the syllabus needs *the same shift*, not the same date — its
 * week 4 may already sit somewhere else.
 *
 * `term_end` moves with it. Nothing else would notice otherwise: `class_pace`
 * derives `weeks_in_term` from `term_end - term_start`, so a term extended by
 * a typhoon would keep reporting the old length and read as overloaded for the
 * rest of the semester.
 */
create or replace function public.shift_class_weeks(
  p_class     uuid,
  p_from_week int,
  p_days      int,
  p_reason    text default ''
) returns public.class_week_shifts
language plpgsql security definer set search_path = public as $$
declare
  cls public.classes;
  made public.class_week_shifts;
begin
  select * into cls from public.classes where id = p_class;
  if cls.id is null then
    raise exception 'That class does not exist.' using errcode = 'P0001';
  end if;

  -- `auth.uid() is not null and` so the SQL test harness can call this without
  -- a JWT, the same way decide_reassignment does.
  if auth.uid() is not null and not public.is_class_professor(p_class) then
    raise exception 'Only the professor of this class can move its weeks.'
      using errcode = 'insufficient_privilege';
  end if;

  if cls.term_start is null then
    raise exception 'Set the term dates before moving any weeks.' using errcode = 'P0001';
  end if;

  if p_days = 0 then
    raise exception 'That is the date it already starts on.' using errcode = 'P0001';
  end if;

  -- A week number the syllabus does not have would move nothing and leave a
  -- row nobody could explain.
  if not exists (
    select 1 from public.syllabus_weeks w
     where w.resource_id = cls.syllabus_id and w.week_no = p_from_week
  ) then
    raise exception 'Week % is not in this class''s syllabus.', p_from_week
      using errcode = 'P0001';
  end if;

  insert into public.class_week_shifts (class_id, from_week, days, reason, created_by)
  values (p_class, p_from_week, p_days, coalesce(btrim(p_reason), ''), auth.uid())
  returning * into made;

  update public.classes
     set term_end = term_end + p_days
   where id = p_class and term_end is not null;

  return made;
end;
$$;

revoke all on function public.shift_class_weeks(uuid, int, int, text) from public;
grant execute on function public.shift_class_weeks(uuid, int, int, text) to authenticated;

-- --------------------------------------------------------- what it stranded

/**
 * Deadlines that fell in the range this shift moved.
 *
 * The test is the calendar, not the week binding: a deadline is affected when
 * it fell **on or after the old start of `from_week`**, because that is the
 * date everything moved from. Going by `projects.start_week` instead would
 * miss every task, since tasks carry a `due_at` and no week at all.
 *
 * The old start is this shift's current start minus its own days, which stays
 * right however many other shifts the class has. Read-only, so the client
 * calls it to build the review list before anything is written.
 */
create or replace function public.class_shift_impact(p_shift uuid)
returns table (
  kind      text,
  ref_id    uuid,
  label     text,
  parent    text,
  old_due   timestamptz,
  new_due   timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  sh        public.class_week_shifts;
  boundary  date;
begin
  select * into sh from public.class_week_shifts where class_week_shifts.id = p_shift;
  if sh.id is null then
    raise exception 'That shift does not exist.' using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.is_class_professor(sh.class_id) then
    raise exception 'Only the professor of this class can see what its shift affected.'
      using errcode = 'insufficient_privilege';
  end if;

  select (c.term_start
          + ((sh.from_week - 1) * 7)
          -- `::int` because sum() is bigint and there is no `date + bigint`.
          + coalesce((
              select sum(s.days)::int from public.class_week_shifts s
               where s.class_id = sh.class_id and s.from_week <= sh.from_week
            ), 0)
          - sh.days)::date
    into boundary
    from public.classes c
   where c.id = sh.class_id;

  return query
  select 'project'::text,
         p.id,
         p.title,
         ''::text,
         p.due_at,
         p.due_at + make_interval(days => sh.days)
    from public.projects p
   where p.class_id = sh.class_id
     and p.archived_at is null
     and p.due_at is not null
     and p.due_at >= boundary::timestamptz
  union all
  select 'task'::text,
         t.id,
         t.title,
         p.title,
         t.due_at,
         t.due_at + make_interval(days => sh.days)
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p       on p.id = b.project_id
   where p.class_id = sh.class_id
     and p.archived_at is null
     and t.due_at is not null
     and t.due_at >= boundary::timestamptz
   order by 5;
end;
$$;

revoke all on function public.class_shift_impact(uuid) from public;
grant execute on function public.class_shift_impact(uuid) to authenticated;

-- ----------------------------------------------------------- moving them on

/**
 * Move the deadlines the professor ticked, and tell the students.
 *
 * Only the ids passed in. Anything left off the list stays exactly where it
 * was, which is the point of the review step.
 *
 * A project's `release_at` moves with its `due_at`. Moving one without the
 * other can put a project's release after its own deadline, and nobody
 * reviewing a list of due dates would think to check for that.
 *
 * Notifications are **ungated by `notification_prefs`**, under the rule stated
 * in notifications.sql: anything a person must act on arrives regardless of
 * their settings. A moved deadline is the clearest case of that there is.
 *
 * One per moved project to every active member of the class. Tasks notify only
 * their own assignees, and only when their project's deadline did not also
 * move — a student holding four tasks in the midterm does not need five
 * notifications saying the midterm moved.
 */
create or replace function public.apply_shift_to_deadlines(
  p_shift    uuid,
  p_projects uuid[] default '{}',
  p_tasks    uuid[] default '{}'
) returns int
language plpgsql security definer set search_path = public as $$
declare
  sh      public.class_week_shifts;
  cls     public.classes;
  moved   int := 0;
  n       int;
  note    text;
begin
  select * into sh from public.class_week_shifts where id = p_shift;
  if sh.id is null then
    raise exception 'That shift does not exist.' using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.is_class_professor(sh.class_id) then
    raise exception 'Only the professor of this class can move its deadlines.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into cls from public.classes where id = sh.class_id;
  note := case when sh.reason = '' then '' else ' · ' || sh.reason end;

  -- ------------------------------------------------------------- projects
  update public.projects p
     set due_at     = p.due_at + make_interval(days => sh.days),
         release_at = case
                        when p.release_at is null then null
                        else p.release_at + make_interval(days => sh.days)
                      end
   where p.id = any(coalesce(p_projects, '{}'))
     and p.class_id = sh.class_id
     and p.archived_at is null
     and p.due_at is not null;

  get diagnostics n = row_count;
  moved := moved + n;

  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id,
         'term_shifted',
         sh.class_id,
         p.id,
         p.title || ' moved',
         'Now due ' || to_char(p.due_at, 'DD Mon') || ' in ' || cls.name || note
    from public.projects p
    join public.class_members m on m.class_id = sh.class_id and m.status = 'active'
   where p.id = any(coalesce(p_projects, '{}'))
     and p.class_id = sh.class_id
     and p.archived_at is null;

  -- ---------------------------------------------------------------- tasks
  update public.project_tasks t
     set due_at = t.due_at + make_interval(days => sh.days)
    from public.project_boards b
    join public.projects p on p.id = b.project_id
   where t.board_id = b.id
     and t.id = any(coalesce(p_tasks, '{}'))
     and p.class_id = sh.class_id
     and t.due_at is not null;

  get diagnostics n = row_count;
  moved := moved + n;

  insert into public.notifications (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'term_shifted',
         sh.class_id,
         p.id,
         t.id,
         t.title || ' moved',
         'Now due ' || to_char(t.due_at, 'DD Mon') || ' in ' || p.title || note
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p       on p.id = b.project_id
   where t.id = any(coalesce(p_tasks, '{}'))
     and p.class_id = sh.class_id
     -- The project's own notification already said the deadline moved.
     and not (p.id = any(coalesce(p_projects, '{}')));

  return moved;
end;
$$;

revoke all on function public.apply_shift_to_deadlines(uuid, uuid[], uuid[]) from public;
grant execute on function public.apply_shift_to_deadlines(uuid, uuid[], uuid[]) to authenticated;

commit;
