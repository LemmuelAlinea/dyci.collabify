-- supabase/project-notification-rules.sql
--
-- A work project's notification settings: which events the project sends.
-- Each person still silences notices for themselves in Account → Notifications
-- (notification_prefs).
--
-- Five general_projects columns, written through the existing update policy
-- (general_has edit_project, so the project manager). Their defaults are the
-- owner's PDF timings, for new and existing projects:
--   sprint_end_reminder_days     1 (1, 2 or 3 days before ends_on; null = off)
--   task_overdue_alerts          on
--   milestone_due_reminder_days  2 (1, 2, 3 or 7 days before due_on; null = off)
--   task_assignment_notices      on
--   sprint_completion_notices    on
-- milestone_overdue_alerts (project-milestone-rules.sql) is the sixth setting.
--
-- Four notification types: sprint_ending_soon, general_task_overdue,
-- milestone_due_soon and sprint_completed (task_overdue stays class-only).
--
-- Reminder stamps, each written only by the reminder jobs (or another write
-- with no signed-in person, such as a restore), so every reminder goes once:
--   general_sprints.end_reminded_at      cleared when ends_on moves later
--   general_milestones.due_reminded_at   cleared when due_on moves later or is cleared
--   general_task_reminders (task_id, project_id, overdue_notified_at)
--                                        deleted when due_at moves later or is cleared
-- On sprints and milestones a signed-in person's value is dropped (kept as it
-- was on an update, null on an insert), like guard_general_milestone_overdue.
-- A task's stamp is a side table, not a task column, so the job never writes a
-- task row (which would bump updated_at, trip the handoff "A task changed"
-- checks and reach every open client through realtime). It has RLS and no
-- policies, is revoked from anon and authenticated, and is not in realtime. An
-- earlier date keeps every stamp.
--
-- Triggers, added beside the existing ones (none of those is redefined):
--   general_sprints_zz_reminder     (guard_general_sprint_reminder), before
--                                   insert or update, after _guard, _prepare
--                                   and _run_guard
--   general_milestones_zz_reminder  (guard_general_milestone_reminder), before
--                                   insert or update, after _guard, _overdue
--                                   and _rules
--   general_tasks_zz_reminder       (clear_general_task_reminder), after update
--                                   when due_at is cleared or moves later:
--                                   deletes the task's general_task_reminders row
--
-- Redefined from their live definitions:
--   notify_general_assignment() (last written by general-archive-rbac.sql):
--     unchanged, except a work project with task_assignment_notices off sends
--     no general_task_assigned. Handoff notices (work_task_handoff) are not
--     assignment notices and keep going. Class boards ignore the switch.
--   send_milestone_overdue_alerts(p_now, p_project) (project-milestone-rules.sql):
--     unchanged, except each recipient also needs their own
--     deadline_reminders. The milestone is stamped whether or not anyone
--     received it.
--
-- Class boards and class tables are untouched.
--
-- Run after project-milestone-rules.sql, then anon-lockdown.sql. Re-running
-- general-archive-rbac.sql (or any file that redefines
-- notify_general_assignment) or project-milestone-rules.sql means re-running
-- this file afterwards, then anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

-- A new enum value must be committed before anything can use it.
begin;
do $$
begin
  alter type public.notification_type add value if not exists 'sprint_ending_soon';
  alter type public.notification_type add value if not exists 'general_task_overdue';
  alter type public.notification_type add value if not exists 'milestone_due_soon';
  alter type public.notification_type add value if not exists 'sprint_completed';
end $$;
commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_projects
  add column if not exists sprint_end_reminder_days int default 1
    check (sprint_end_reminder_days in (1, 2, 3)),
  add column if not exists task_overdue_alerts boolean not null default true,
  add column if not exists milestone_due_reminder_days int default 2
    check (milestone_due_reminder_days in (1, 2, 3, 7)),
  add column if not exists task_assignment_notices boolean not null default true,
  add column if not exists sprint_completion_notices boolean not null default true;

alter table public.general_sprints
  add column if not exists end_reminded_at timestamptz;

alter table public.general_milestones
  add column if not exists due_reminded_at timestamptz;

-- ---------------------------------------------------------------- stamps

/**
 * Only the reminder job (or another write with no signed-in person) writes
 * end_reminded_at; a person's value is dropped. ends_on moved later clears it,
 * so the new end can remind again; an earlier end keeps it.
 */
create or replace function public.guard_general_sprint_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.end_reminded_at := null;
    end if;
    return new;
  end if;
  if auth.uid() is not null then
    new.end_reminded_at := old.end_reminded_at;
  end if;
  if new.ends_on is null or new.ends_on > old.ends_on then
    new.end_reminded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists general_sprints_zz_reminder on public.general_sprints;
create trigger general_sprints_zz_reminder
  before insert or update on public.general_sprints
  for each row execute function public.guard_general_sprint_reminder();

-- A task's overdue stamp lives off the task row: the job writing a task row
-- would bump updated_at (tripping the handoff "A task changed" checks) and
-- reach every open client through realtime. An earlier draft of this file put
-- it on general_tasks; it never went live.
drop trigger if exists general_tasks_zz_reminder on public.general_tasks;
drop function if exists public.guard_general_task_reminder();
alter table public.general_tasks drop column if exists overdue_notified_at;

-- One row per task the overdue job has alerted. No policies: only the job
-- (and the database's own triggers) read or write it.
create table if not exists public.general_task_reminders (
  task_id             uuid primary key references public.general_tasks (id) on delete cascade,
  project_id          uuid not null,
  overdue_notified_at timestamptz not null
);

alter table public.general_task_reminders enable row level security;
revoke all on table public.general_task_reminders from public, anon, authenticated;

/**
 * A due time moved later, or cleared, forgets the task's overdue stamp, so the
 * new due time can alert again; an earlier one keeps it.
 */
create or replace function public.clear_general_task_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.general_task_reminders where task_id = new.id;
  return null;
end;
$$;

create trigger general_tasks_zz_reminder
  after update on public.general_tasks
  for each row
  when (new.due_at is null or new.due_at > old.due_at)
  execute function public.clear_general_task_reminder();

/**
 * Only the reminder job (or another write with no signed-in person) writes
 * due_reminded_at; a person's value is dropped. due_on moved later, or
 * cleared, clears it, so the new date can remind again; an earlier date keeps
 * it.
 */
create or replace function public.guard_general_milestone_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.due_reminded_at := null;
    end if;
    return new;
  end if;
  if auth.uid() is not null then
    new.due_reminded_at := old.due_reminded_at;
  end if;
  if new.due_on is null or new.due_on > old.due_on then
    new.due_reminded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists general_milestones_zz_reminder on public.general_milestones;
create trigger general_milestones_zz_reminder
  before insert or update on public.general_milestones
  for each row execute function public.guard_general_milestone_reminder();

-- ---------------------------------------------------------------- assignment notices

/**
 * Tells a person a task was handed to them, unless they claimed it, their
 * "Task assignments" switch is off, they can't see the task, or the work
 * project's task_assignment_notices is off. Class boards ignore the switch.
 */
create or replace function public.notify_general_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Claiming a task yourself is not news to you.
  if new.assigned_by is null or new.assigned_by = new.user_id then
    return new;
  end if;
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select new.user_id,
         'general_task_assigned'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         p.name
    from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = new.user_id
   where t.id = new.task_id and np.task_assignments
     and (p.class_board_id is not null or p.task_assignment_notices)
     and public.general_user_sees_task(t.id, new.user_id);
  return new;
end;
$$;

-- ---------------------------------------------------------------- milestone overdue alerts

/**
 * Tells the project manager and active coordinators about each milestone
 * that has become overdue, once per due date, when their own "Deadline
 * reminders" switch is on. The milestone is stamped whether or not anyone
 * received it. See project-milestone-rules.sql. Every project, or only
 * p_project. Returns the number of milestones alerted.
 */
create or replace function public.send_milestone_overdue_alerts(
  p_now timestamptz default now(),
  p_project uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Manila')::date;
  v_count int;
begin
  with due as (
    select m.id, m.project_id, m.name, m.due_on, gp.name as project_name
      from public.general_milestones m
      join public.general_projects gp on gp.id = m.project_id
     where (p_project is null or m.project_id = p_project)
       and gp.class_board_id is null
       and gp.archived_at is null
       and gp.trashed_at is null
       and gp.milestone_overdue_alerts
       and m.due_on < v_today
       and m.reached_at is null
       and m.overdue_notified_at is null
     for update of m skip locked
  ), stamped as (
    update public.general_milestones g
       set overdue_notified_at = p_now
      from due
     where g.id = due.id
    returning due.id, due.project_id, due.name, due.due_on, due.project_name
  ), sent as (
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select gm.user_id, 'milestone_overdue'::public.notification_type, s.project_id,
           format('%s is overdue in %s', s.name, s.project_name),
           format('It was due %s.', to_char(s.due_on, 'FMMon FMDD'))
      from stamped s
      join public.general_members gm on gm.project_id = s.project_id
      join public.profiles pr on pr.id = gm.user_id
      join public.notification_prefs np on np.user_id = gm.user_id
     where gm.role in ('pm', 'coordinator') and pr.status = 'active'
       and np.deadline_reminders
    returning 1
  )
  select count(*) into v_count from stamped;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.guard_general_sprint_reminder() from public, anon, authenticated;
revoke all on function public.clear_general_task_reminder() from public, anon, authenticated;
revoke all on function public.guard_general_milestone_reminder() from public, anon, authenticated;
revoke all on function public.send_milestone_overdue_alerts(timestamptz, uuid) from public, anon, authenticated;

commit;
