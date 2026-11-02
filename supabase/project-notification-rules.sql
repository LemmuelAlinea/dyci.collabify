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
--                                   when a set due_at is cleared or moves
--                                   later: deletes the task's
--                                   general_task_reminders row
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
--   complete_general_sprint(p_sprint, p_carry_to) and
--   run_sprint_automation(p_now, p_project) (both sprint-settings.sql):
--     unchanged, except each calls notify_general_sprint_completed just
--     before unfinished work moves.
--
-- Sprint completion: both finish paths carry unfinished work before the state
-- changes, so the notice is written from inside them, just before the carry,
-- while the sprint still holds its team and its counts.
-- notify_general_sprint_completed sends sprint_completed, when the project's
-- sprint_completion_notices is on, to the project manager, active
-- coordinators and every holder of a released, live task in the sprint, each
-- with their own "Project updates" on, except the signed-in person finishing
-- it. When the automation finishes it, the planners are skipped (they get
-- sprint_automation) and nobody is left out. Stakeholders and QA get none.
-- Reopening and finishing again announces again.
--
-- The daily reminders job, send_project_reminders(p_now, p_project), runs by
-- cron 'collabify-project-reminders' at 00:00 UTC (08:00 Manila) on live work
-- projects (not archived, not trashed). Each reminder goes on the first run
-- when it is due and not yet sent, and each notice needs the recipient's own
-- "Deadline reminders":
--   sprint_ending_soon    the running sprint ends within
--                         sprint_end_reminder_days; to the project manager and
--                         active coordinators, with its unfinished count
--   general_task_overdue  a released, live task not done whose due day
--                         (Manila) has passed; to each holder, plus one
--                         summary per project per run to the project manager
--                         and active coordinators. With task_overdue_alerts
--                         off the task is stamped with no notice, so turning
--                         the alerts on later sends no backlog
--   milestone_due_soon    an unreached milestone due within
--                         milestone_due_reminder_days; to the project manager
--                         and active coordinators
-- Stakeholders and QA get none of these. At the end of the file,
-- mark_project_reminders_sent() stamps everything that already qualifies,
-- with no notice, so the first morning sends no old cases.
--
-- Class boards and class tables are untouched.
--
-- Run after project-milestone-rules.sql, then anon-lockdown.sql. Re-running
-- general-archive-rbac.sql (or any file that redefines
-- notify_general_assignment), project-milestone-rules.sql, sprint-settings.sql
-- (or work-planning.sql or sprint-reopen.sql, which mean re-running
-- sprint-settings.sql) means re-running this file afterwards, then
-- anon-lockdown.sql; otherwise finished sprints stop being announced.
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
-- reach every open client through realtime. One row per task the overdue job
-- has alerted. No policies: only the job (and the database's own triggers)
-- read or write it.
create table if not exists public.general_task_reminders (
  task_id             uuid primary key references public.general_tasks (id) on delete cascade,
  project_id          uuid not null references public.general_projects (id) on delete cascade,
  overdue_notified_at timestamptz not null
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.general_task_reminders'::regclass
                    and conname = 'general_task_reminders_project_id_fkey') then
    alter table public.general_task_reminders
      add constraint general_task_reminders_project_id_fkey
      foreign key (project_id) references public.general_projects (id) on delete cascade;
  end if;
end $$;

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

drop trigger if exists general_tasks_zz_reminder on public.general_tasks;
create trigger general_tasks_zz_reminder
  after update on public.general_tasks
  for each row
  when (old.due_at is not null and (new.due_at is null or new.due_at > old.due_at))
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

-- ---------------------------------------------------------------- daily reminders

/**
 * The morning reminders for live work projects (not archived, not trashed),
 * every project or only p_project, on the Manila day of p_now. Each goes once,
 * on the first run when it is due and not yet sent (a missed morning catches
 * up the next day), and every notice also needs the recipient's own
 * "Deadline reminders". Planners are the project manager and active
 * coordinators; stakeholders and QA get none of these.
 * - Sprint ending (sprint_end_reminder_days on): the running sprint ends
 *   today or within that many days. The planners get sprint_ending_soon with
 *   the count of its released, live tasks not done.
 * - Task overdue: a released, live task not done whose due day (Manila) is
 *   before today. With task_overdue_alerts on, each holder gets
 *   general_task_overdue for the task and the planners get one summary per
 *   project for this run's newly overdue tasks; with it off the task is
 *   stamped silently, so turning it on later sends no backlog. The stamp is a
 *   general_task_reminders row; the task row is never written or locked, and
 *   only the ids this run's insert returns notify.
 * - Milestone due (milestone_due_reminder_days on): an unreached milestone due
 *   today or within that many days. The planners get milestone_due_soon.
 * Everything found is stamped with p_now whether or not anyone received it.
 * Returns the number of sprints, tasks and milestones stamped.
 */
create or replace function public.send_project_reminders(
  p_now timestamptz default now(),
  p_project uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Manila')::date;
  v_sprints int;
  v_tasks int;
  v_milestones int;
begin
  -- Sprint ending.
  with due as (
    select s.id, s.project_id, s.name, s.ends_on - v_today as days_left
      from public.general_sprints s
      join public.general_projects gp on gp.id = s.project_id
     where (p_project is null or s.project_id = p_project)
       and gp.class_board_id is null
       and gp.archived_at is null
       and gp.trashed_at is null
       and gp.sprint_end_reminder_days is not null
       and s.state = 'active'
       and s.ends_on >= v_today
       and s.ends_on - v_today <= gp.sprint_end_reminder_days
       and s.end_reminded_at is null
     for update of s skip locked
  ), stamped as (
    update public.general_sprints g
       set end_reminded_at = p_now
      from due
     where g.id = due.id
    returning due.id, due.project_id, due.name, due.days_left
  ), counted as (
    select s.*,
           (select count(*) from public.general_tasks t
             where t.sprint_id = s.id
               and t.routing_state = 'released'
               and t.archived_at is null
               and t.trashed_at is null
               and t.status <> 'done') as open_count
      from stamped s
  ), sent as (
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select gm.user_id, 'sprint_ending_soon'::public.notification_type, c.project_id,
           case c.days_left
             when 0 then format('%s ends today', c.name)
             when 1 then format('%s ends tomorrow', c.name)
             else format('%s ends in %s days', c.name, c.days_left)
           end,
           case c.open_count
             when 0 then 'Every task is done.'
             when 1 then '1 task remains unfinished.'
             else format('%s tasks remain unfinished.', c.open_count)
           end
      from counted c
      join public.general_members gm on gm.project_id = c.project_id
      join public.profiles pr on pr.id = gm.user_id
      join public.notification_prefs np on np.user_id = gm.user_id
     where gm.role in ('pm', 'coordinator') and pr.status = 'active'
       and np.deadline_reminders
    returning 1
  )
  select count(*) into v_sprints from stamped;

  -- Task overdue.
  with due as (
    select t.id, t.project_id, t.title, t.due_at, gp.name as project_name,
           gp.task_overdue_alerts as alerts
      from public.general_tasks t
      join public.general_projects gp on gp.id = t.project_id
     where (p_project is null or t.project_id = p_project)
       and gp.class_board_id is null
       and gp.archived_at is null
       and gp.trashed_at is null
       and t.routing_state = 'released'
       and t.archived_at is null
       and t.trashed_at is null
       and t.status <> 'done'
       and t.due_at is not null
       and (t.due_at at time zone 'Asia/Manila')::date < v_today
       and not exists (select 1 from public.general_task_reminders r where r.task_id = t.id)
  ), stamped as (
    -- The insert decides who is told: a concurrent run that stamped a task
    -- first wins, and only the ids returned here notify. Tasks are never
    -- locked, so edits, comments and holders go on meanwhile.
    insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
    select due.id, due.project_id, p_now from due
    on conflict (task_id) do nothing
    returning task_id
  ), fresh as (
    -- With task_overdue_alerts off the stamp is silent, so turning the alerts
    -- on later sends no backlog.
    select due.* from due join stamped on stamped.task_id = due.id where due.alerts
  ), held as (
    insert into public.notifications
      (user_id, type, general_project_id, general_task_id, title, preview)
    select a.user_id, 'general_task_overdue'::public.notification_type, f.project_id, f.id,
           format('%s is overdue', f.title),
           format('It was due %s.', to_char(f.due_at at time zone 'Asia/Manila', 'FMMon FMDD'))
      from fresh f
      join public.general_task_assignees a on a.task_id = f.id
      join public.general_members gm on gm.project_id = f.project_id and gm.user_id = a.user_id
      join public.profiles pr on pr.id = a.user_id
      join public.notification_prefs np on np.user_id = a.user_id
     where gm.role not in ('stakeholder', 'qa') and pr.status = 'active'
       and np.deadline_reminders
    returning 1
  ), summary as (
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select gm.user_id, 'general_task_overdue'::public.notification_type, c.project_id,
           case c.k
             when 1 then format('1 task became overdue in %s', c.project_name)
             else format('%s tasks became overdue in %s', c.k, c.project_name)
           end,
           'Open Tasks to see them.'
      from (select project_id, project_name, count(*) as k
              from fresh group by project_id, project_name) c
      join public.general_members gm on gm.project_id = c.project_id
      join public.profiles pr on pr.id = gm.user_id
      join public.notification_prefs np on np.user_id = gm.user_id
     where gm.role in ('pm', 'coordinator') and pr.status = 'active'
       and np.deadline_reminders
    returning 1
  )
  select count(*) into v_tasks from stamped;

  -- Milestone due. Past due is the overdue alert's job.
  with due as (
    select m.id, m.project_id, m.name, m.due_on - v_today as days_left, gp.name as project_name
      from public.general_milestones m
      join public.general_projects gp on gp.id = m.project_id
     where (p_project is null or m.project_id = p_project)
       and gp.class_board_id is null
       and gp.archived_at is null
       and gp.trashed_at is null
       and gp.milestone_due_reminder_days is not null
       and m.reached_at is null
       and m.due_on >= v_today
       and m.due_on - v_today <= gp.milestone_due_reminder_days
       and m.due_reminded_at is null
     for update of m skip locked
  ), stamped as (
    update public.general_milestones g
       set due_reminded_at = p_now
      from due
     where g.id = due.id
    returning due.id, due.project_id, due.name, due.days_left, due.project_name
  ), sent as (
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select gm.user_id, 'milestone_due_soon'::public.notification_type, s.project_id,
           case s.days_left
             when 0 then format('%s is due today', s.name)
             when 1 then format('%s is due tomorrow', s.name)
             else format('%s is due in %s days', s.name, s.days_left)
           end,
           s.project_name
      from stamped s
      join public.general_members gm on gm.project_id = s.project_id
      join public.profiles pr on pr.id = gm.user_id
      join public.notification_prefs np on np.user_id = gm.user_id
     where gm.role in ('pm', 'coordinator') and pr.status = 'active'
       and np.deadline_reminders
    returning 1
  )
  select count(*) into v_milestones from stamped;

  return v_sprints + v_tasks + v_milestones;
end;
$$;

/**
 * Marks as sent, with no notice, what already qualifies on the Manila day of
 * p_now, every switch on or off: each running sprint that ends within its
 * sprint_end_reminder_days (3 when the reminder is off), each released, live
 * task not done whose due day has passed, and each unreached milestone due
 * within its milestone_due_reminder_days (7 when the reminder is off). Run
 * when this file is applied, so the first morning sends none of these. After
 * that, a sprint or milestone that comes into range while its reminder is off
 * stays unstamped and is sent once the reminder is turned on; an overdue task
 * is stamped by the daily job whether or not its alerts are on. Every project,
 * or only p_project. Returns the number stamped.
 */
create or replace function public.mark_project_reminders_sent(
  p_now timestamptz default now(),
  p_project uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Manila')::date;
  v_sprints int;
  v_tasks int;
  v_milestones int;
begin
  update public.general_sprints s
     set end_reminded_at = p_now
    from public.general_projects gp
   where gp.id = s.project_id
     and (p_project is null or s.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and s.state = 'active'
     and s.ends_on >= v_today
     and s.ends_on - v_today <= coalesce(gp.sprint_end_reminder_days, 3)
     and s.end_reminded_at is null;
  get diagnostics v_sprints = row_count;

  insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
  select t.id, t.project_id, p_now
    from public.general_tasks t
    join public.general_projects gp on gp.id = t.project_id
   where (p_project is null or t.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and t.routing_state = 'released'
     and t.archived_at is null
     and t.trashed_at is null
     and t.status <> 'done'
     and t.due_at is not null
     and (t.due_at at time zone 'Asia/Manila')::date < v_today
  on conflict (task_id) do nothing;
  get diagnostics v_tasks = row_count;

  update public.general_milestones m
     set due_reminded_at = p_now
    from public.general_projects gp
   where gp.id = m.project_id
     and (p_project is null or m.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and m.reached_at is null
     and m.due_on >= v_today
     and m.due_on - v_today <= coalesce(gp.milestone_due_reminder_days, 7)
     and m.due_reminded_at is null;
  get diagnostics v_milestones = row_count;

  return v_sprints + v_tasks + v_milestones;
end;
$$;

-- ---------------------------------------------------------------- sprint completion

/**
 * Announces that a running sprint is finishing (sprint_completed), when the
 * work project's sprint_completion_notices is on. Both finish paths call it
 * just before unfinished work moves, so the sprint team and the counts are
 * the sprint's as it ends; the notices commit with the finish or not at all.
 * Recipients: the project manager and active coordinators, plus every holder
 * of a released, live task in the sprint (done or not), each with their own
 * "Project updates" on. Stakeholders and QA get none. The signed-in person
 * finishing it is left out. When the automation finishes it
 * (collabify.sprint_automation on) nobody is left out, and the planners are
 * skipped because sprint_automation already told them.
 * Title "{sprint} is finished"; preview "{done} of {total} tasks done.", plus
 * " {moved} moved to {next sprint}." or " {moved} went back to the backlog."
 * when unfinished work moves. The counts are released, live tasks; every
 * unfinished one moves (archived ones stay, and trashed tasks are archived).
 * Callable only from a finish: the service role, the automation, or
 * complete_general_sprint, which sets collabify.sprint_finish to the sprint
 * for the call. A client can't set that flag.
 */
create or replace function public.notify_general_sprint_completed(p_sprint uuid, p_carry_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean := coalesce(current_setting('collabify.sprint_automation', true), 'off') = 'on';
  v_me   uuid := auth.uid();
begin
  if v_me is not null and not v_auto
     and coalesce(current_setting('collabify.sprint_finish', true), '') <> p_sprint::text then
    raise exception 'A sprint completion notice goes out only when the sprint finishes. Finish the sprint instead.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select gm.user_id, 'sprint_completed'::public.notification_type, s.project_id,
         format('%s is finished', s.name),
         format('%s of %s tasks done.', c.done, c.total)
           || case when c.total = c.done then ''
                   when nxt.id is not null
                     then format(' %s moved to %s.', c.total - c.done, nxt.name)
                   else format(' %s went back to the backlog.', c.total - c.done)
              end
    from public.general_sprints s
    join public.general_projects gp on gp.id = s.project_id
    cross join lateral (
      select count(*) filter (where t.status = 'done') as done, count(*) as total
        from public.general_tasks t
       where t.sprint_id = s.id
         and t.routing_state = 'released'
         and t.archived_at is null
         and t.trashed_at is null
    ) c
    left join public.general_sprints nxt on nxt.id = p_carry_to and nxt.project_id = s.project_id
    join public.general_members gm on gm.project_id = s.project_id
    join public.profiles pr on pr.id = gm.user_id
    join public.notification_prefs np on np.user_id = gm.user_id
   where s.id = p_sprint
     and s.state = 'active'
     and gp.class_board_id is null
     and gp.sprint_completion_notices
     and gm.role not in ('stakeholder', 'qa')
     and pr.status = 'active'
     and np.project_updates
     and (v_auto or gm.user_id is distinct from v_me)
     and not (v_auto and gm.role in ('pm', 'coordinator'))
     and ((not v_auto and gm.role in ('pm', 'coordinator'))
          or exists (select 1
                       from public.general_task_assignees a
                       join public.general_tasks t on t.id = a.task_id
                      where a.user_id = gm.user_id
                        and t.sprint_id = s.id
                        and t.routing_state = 'released'
                        and t.archived_at is null
                        and t.trashed_at is null));
end;
$$;

/**
 * Finish a running sprint. Unfinished tasks move to p_carry_to, or back to the
 * backlog when it is null. sprint-settings.sql's body, as live; one addition:
 * the sprint completion notice goes out just before unfinished work moves.
 */
create or replace function public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql set search_path = public as $$
declare
  s public.general_sprints;
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can_run_sprint(s.project_id) then
    raise exception 'Only the project manager or a coordinator can finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'active' then
    raise exception 'Only a running sprint can be finished.' using errcode = 'check_violation';
  end if;
  if p_carry_to is not null and not exists (
    select 1 from public.general_sprints
     where id = p_carry_to and project_id = s.project_id and state = 'planned'
  ) then
    raise exception 'Unfinished tasks can only move to a planned sprint on this project.'
      using errcode = 'check_violation';
  end if;

  -- The sprint team and the counts as the sprint ends, before work moves.
  perform set_config('collabify.sprint_finish', p_sprint::text, true);
  perform public.notify_general_sprint_completed(p_sprint, p_carry_to);
  perform set_config('collabify.sprint_finish', '', true);

  -- Archived unfinished tasks stay in the finished sprint on purpose.
  update public.general_tasks
     set sprint_id = p_carry_to
   where sprint_id = p_sprint and status <> 'done' and archived_at is null;

  update public.general_sprints set state = 'completed' where id = p_sprint;
end;
$$;

/**
 * sprint-settings.sql's run_sprint_automation, as live; one addition: when it
 * finishes a sprint, the sprint completion notice goes out just before
 * unfinished work moves (to the sprint team only; the planners get
 * sprint_automation). See sprint-settings.sql for what the job does.
 */
create or replace function public.run_sprint_automation(p_now timestamptz default now(),
                                                        p_project uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  was       text := current_setting('collabify.sprint_automation', true);
  today     date := (p_now at time zone 'Asia/Manila')::date;
  cfg       record;
  running   public.general_sprints;
  nxt       public.general_sprints;
  made      public.general_sprints;
  due       boolean;
  finishing boolean;
  changed   boolean;
  handled   uuid;
  starts    date;
  target    uuid;
  moved     int;
  total     int := 0;
begin
  perform set_config('collabify.sprint_automation', 'on', true);

  for cfg in
    select s.*, p.ends_on as due_on
      from public.general_sprint_settings s
      join public.general_projects p on p.id = s.project_id
     where (s.auto_finish or s.auto_start)
       and p.archived_at is null and p.class_board_id is null
       and (p_project is null or s.project_id = p_project)
     order by s.project_id
  loop
    begin
      perform pg_advisory_xact_lock(hashtext('sprint-automation:' || cfg.project_id));
      changed := false;
      due := (p_now at time zone 'Asia/Manila')::time >= cfg.run_at;

      select * into running from public.general_sprints
       where project_id = cfg.project_id and state = 'active';
      finishing := found and cfg.auto_finish
                   and (running.ends_on < today - 1 or (running.ends_on < today and due));

      handled := null;
      if finishing then
        handled := running.id;
      elsif running.id is null then
        select id into handled from public.general_sprints
         where project_id = cfg.project_id and state = 'completed'
           and completed_at >= cfg.auto_start_since
         order by completed_at desc, created_at desc limit 1;
      end if;

      if cfg.auto_start and handled is not null
         and handled is distinct from cfg.auto_created_after
         and not exists (select 1 from public.general_sprints
                          where project_id = cfg.project_id and state = 'planned') then
        starts := public.general_next_sprint_start(cfg.project_id, today);
        if cfg.due_on is null or starts <= cfg.due_on then
          insert into public.general_sprints (project_id, name, starts_on, ends_on)
          select cfg.project_id, 'Sprint ' || (count(*) + 1), starts, starts + cfg.length_days - 1
            from public.general_sprints where project_id = cfg.project_id
          returning * into made;
          perform public.notify_sprint_automation(cfg.project_id,
            made.name || ' was created on its own',
            'It runs ' || to_char(made.starts_on, 'Mon FMDD') || ' to '
              || to_char(made.ends_on, 'Mon FMDD, YYYY') || '.');
          changed := true;
        end if;
        update public.general_sprint_settings set auto_created_after = handled
         where project_id = cfg.project_id;
      end if;

      if finishing then
        target := null;
        if cfg.carry = 'next' then
          select id into target from public.general_sprints
           where project_id = cfg.project_id and state = 'planned'
           order by starts_on, created_at limit 1;
        end if;

        -- The sprint team and the counts as the sprint ends, before work moves.
        perform public.notify_general_sprint_completed(running.id, target);

        -- As complete_general_sprint: archived unfinished tasks stay behind.
        -- The notice counts released tasks only; private planning tasks move with
        -- the rest but are not reported.
        with u as (
          update public.general_tasks set sprint_id = target
           where sprint_id = running.id and status <> 'done' and archived_at is null
          returning routing_state)
        select count(*) filter (where coalesce(routing_state, 'released') = 'released')
          into moved from u;

        update public.general_sprints set state = 'completed' where id = running.id;

        perform public.notify_sprint_automation(cfg.project_id,
          running.name || ' finished on its own',
          case when moved = 0 then 'Every task was done.'
               else moved || ' unfinished ' || case when moved = 1 then 'task' else 'tasks' end
                    || coalesce(' moved to ' || (select name from public.general_sprints where id = target),
                                ' returned to the backlog') || '.'
          end);
        changed := true;
      end if;

      if cfg.auto_start
         and not exists (select 1 from public.general_sprints
                          where project_id = cfg.project_id and state = 'active') then
        select * into nxt from public.general_sprints
         where project_id = cfg.project_id and state = 'planned' and ends_on >= today
         order by starts_on, created_at limit 1;
        if found and (nxt.starts_on < today or (nxt.starts_on = today and due)) then
          update public.general_sprints set state = 'active' where id = nxt.id;
          perform public.notify_sprint_automation(cfg.project_id,
            nxt.name || ' started on its own',
            to_char(nxt.starts_on, 'Mon FMDD') || ' to ' || to_char(nxt.ends_on, 'Mon FMDD, YYYY'));
          changed := true;
        end if;
      end if;

      if changed then
        total := total + 1;
      end if;
    exception when others then
      raise warning 'Sprint automation skipped project %: %', cfg.project_id, sqlerrm;
    end;
  end loop;

  perform set_config('collabify.sprint_automation', coalesce(nullif(was, ''), 'off'), true);
  return total;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.guard_general_sprint_reminder() from public, anon, authenticated;
revoke all on function public.clear_general_task_reminder() from public, anon, authenticated;
revoke all on function public.guard_general_milestone_reminder() from public, anon, authenticated;
revoke all on function public.send_milestone_overdue_alerts(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.send_project_reminders(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.mark_project_reminders_sent(timestamptz, uuid) from public, anon, authenticated;
-- complete_general_sprint runs as the caller, so the notice helper is
-- executable by authenticated; it refuses any call that isn't a finish.
revoke all on function public.notify_general_sprint_completed(uuid, uuid) from public, anon;
grant execute on function public.notify_general_sprint_completed(uuid, uuid) to authenticated;
revoke all on function public.complete_general_sprint(uuid, uuid) from public, anon;
grant execute on function public.complete_general_sprint(uuid, uuid) to authenticated;
revoke all on function public.run_sprint_automation(timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- schedule

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-project-reminders');
exception when others then null; end $$;

-- Daily at 00:00 UTC, 08:00 in Manila.
select cron.schedule(
  'collabify-project-reminders',
  '0 0 * * *',
  $cron$ select public.send_project_reminders() $cron$
);

-- ---------------------------------------------------------------- what already qualifies

-- No flood on the first morning: what qualifies now is marked as sent,
-- without a notice. Only new cases notify from here on.
select public.mark_project_reminders_sent();

commit;
