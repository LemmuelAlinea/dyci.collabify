-- supabase/project-task-rules.sql
--
-- A work project's task rules, task priority and subtasks.
--
-- Seven general_projects columns, written through the existing update policy
-- (general_has edit_project, so the project manager): default_priority,
-- default_stage, allow_subtasks, allow_dependencies, allow_multiple_assignees,
-- require_assignee and require_subtasks_done. Their defaults keep today's
-- behaviour: Normal, the first stage, subtasks, dependencies and several
-- holders on, no holder required, subtasks finished before their parent.
--
-- general_tasks gains priority (low, normal, high, urgent) and parent_id (one
-- level of subtasks in the same project). priority has no column default: the
-- general_tasks_0_defaults trigger fills it from the project's default_priority
-- (Normal on a class board's Files project), and existing rows were given Normal.
--
-- Triggers, added beside the existing task guards (none of those is redefined).
-- Row triggers fire in name order:
--
--   general_tasks_0_defaults  before general_tasks_a_stage. Fills priority, and
--     puts a task into the project's default stage when it enters the work: a
--     released insert (only the service role inserts released work;
--     general_tasks_guard keeps every signed-in insert in private planning), or
--     an update that releases it (the handoff RPCs) while it is in the first
--     stage. A release update doesn't name status or stage, so
--     general_tasks_a_stage and general_tasks_zz_qa_entered don't run for it;
--     this trigger sets the matching status and qa_entered_at itself. A
--     default_stage past the last stage falls back to the first.
--   general_tasks_b_rules  after general_tasks_a_stage, so it sees the status
--     synced from the stage (the last stage is Done, the first To do). Parent
--     rules everywhere; on work projects the subtask switch, the holder rule and
--     the completion rule. Every path to Done passes it: a status-only update,
--     a stage move and qa_pass_general_task.
--   general_task_assignees_single  one holder per task when the project turns
--     allow_multiple_assignees off. Tasks that already have several keep them.
--
-- Class boards (class_board_id is not null) keep their behaviour: their tasks
-- take Normal and ignore the switches. project_tasks is not touched.
--
-- Run after project-settings-general.sql, then anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_projects
  add column if not exists default_priority text not null default 'normal'
    check (default_priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists default_stage int not null default 0
    check (default_stage >= 0),
  add column if not exists allow_subtasks boolean not null default true,
  add column if not exists allow_dependencies boolean not null default true,
  add column if not exists allow_multiple_assignees boolean not null default true,
  add column if not exists require_assignee boolean not null default false,
  add column if not exists require_subtasks_done boolean not null default true;

-- The column default only fills existing rows (without firing the task
-- triggers); it is dropped so general_tasks_0_defaults decides for new ones.
alter table public.general_tasks
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists parent_id uuid
    references public.general_tasks (id) on delete cascade;
alter table public.general_tasks alter column priority drop default;

do $$ begin
  alter table public.general_tasks add constraint general_tasks_parent_not_self
    check (parent_id <> id);
exception when duplicate_object then null; end $$;

create index if not exists general_tasks_parent
  on public.general_tasks (parent_id) where parent_id is not null;

-- ---------------------------------------------------------------- defaults

/**
 * The project's default stage, 0-based, for a stage list of p_n stages. One
 * past the last stage falls back to the first.
 */
create or replace function public.general_default_stage(p_default int, p_n int)
returns int language sql immutable set search_path = public as $$
  select case when p_default between 0 and p_n - 1 then p_default else 0 end
$$;

/** Fills a new task's priority and starts work in the project's default stage. */
create or replace function public.apply_general_task_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.general_projects%rowtype;
  n  int;
  d  int;
begin
  select * into gp from public.general_projects where id = new.project_id;

  if tg_op = 'INSERT' and new.priority is null then
    new.priority := case when gp.class_board_id is null
                         then coalesce(gp.default_priority, 'normal')
                         else 'normal' end;
  end if;

  if gp.id is null or gp.class_board_id is not null then
    return new;
  end if;
  n := public.stage_count(gp.stages);
  d := public.general_default_stage(gp.default_stage, n);
  if d = 0 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- general_tasks_guard turns a signed-in insert into private planning.
    if new.routing_state = 'released' and auth.uid() is null
       and new.status = 'todo' and coalesce(new.stage, 0) = 0 then
      new.stage := d;  -- general_tasks_a_stage sets the status from it
    end if;
  elsif new.routing_state = 'released'
        and old.routing_state is distinct from 'released'
        and (new.status, new.stage) is not distinct from (old.status, old.stage)
        and public.general_task_stage_at(old.status, old.stage, n) = 0 then
    new.stage := d;
    new.status := (case when d = n - 1 then 'done' else 'in_progress' end)::public.general_task_status;
    if d = public.general_qa_stage_pick(gp.stages, gp.qa_stage) then
      new.qa_entered_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_0_defaults on public.general_tasks;
create trigger general_tasks_0_defaults
  before insert or update of routing_state on public.general_tasks
  for each row execute function public.apply_general_task_defaults();

-- ---------------------------------------------------------------- rules

/**
 * Subtasks are one level deep, in their parent's project. On a work project:
 * no new subtasks while the switch is off, no released task leaves the first
 * stage without a holder when one is required, and no parent reaches Done
 * (by status or the last stage) while a subtask is open. Archived and trashed
 * subtasks don't hold a parent back.
 */
create or replace function public.check_general_task_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gp      public.general_projects%rowtype;
  par     public.general_tasks%rowtype;
  n       int;
  idx     int;
  old_idx int;
  moved   boolean;
begin
  select * into gp from public.general_projects where id = new.project_id;

  if new.parent_id is not null
     and (tg_op = 'INSERT'
          or new.parent_id is distinct from old.parent_id
          or new.project_id is distinct from old.project_id) then
    if new.parent_id = new.id then
      raise exception 'A task can''t be its own subtask.' using errcode = 'check_violation';
    end if;
    -- Locked so the parent can't become a subtask in the meantime.
    select * into par from public.general_tasks where id = new.parent_id for share;
    if par.id is null or par.project_id <> new.project_id then
      raise exception 'A subtask must be in the same project as its parent.'
        using errcode = 'check_violation';
    end if;
    if gp.class_board_id is null and not gp.allow_subtasks
       and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
      raise exception 'Subtasks are turned off for this project.' using errcode = 'check_violation';
    end if;
    if par.parent_id is not null then
      raise exception 'A subtask can''t have its own subtasks.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE'
       and exists (select 1 from public.general_tasks c where c.parent_id = new.id) then
      raise exception 'This task has subtasks, so it can''t become one.'
        using errcode = 'check_violation';
    end if;
  end if;

  if gp.id is null or gp.class_board_id is not null then
    return new;
  end if;

  n := public.stage_count(gp.stages);
  idx := public.general_task_stage_at(new.status, new.stage, n);

  -- Planning tasks stay unheld; entering the work in the default stage is
  -- the project's own rule, not a move.
  if gp.require_assignee and new.routing_state = 'released' and idx > 0 then
    if tg_op = 'INSERT' then
      moved := idx <> public.general_default_stage(gp.default_stage, n);
    else
      old_idx := public.general_task_stage_at(old.status, old.stage, n);
      moved := old.routing_state = 'released' and idx <> old_idx;
    end if;
    if moved and not exists (select 1 from public.general_task_assignees a
                              where a.task_id = new.id) then
      raise exception 'Give this task a holder before moving it on.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and gp.require_subtasks_done
     and new.status = 'done' and old.status is distinct from 'done'
     and exists (select 1 from public.general_tasks c
                  where c.parent_id = new.id and c.status <> 'done'
                    and c.archived_at is null and c.trashed_at is null) then
    raise exception 'Finish its subtasks first.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists general_tasks_b_rules on public.general_tasks;
create trigger general_tasks_b_rules
  before insert or update of parent_id, project_id, status, stage, routing_state
  on public.general_tasks
  for each row execute function public.check_general_task_rules();

/** One holder per task when the project allows only one. */
create or replace function public.guard_general_task_single_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.general_projects p
              where p.id = new.project_id and p.class_board_id is null
                and not p.allow_multiple_assignees) then
    -- Serializes two people claiming the same task.
    perform 1 from public.general_tasks where id = new.task_id for update;
    if exists (select 1 from public.general_task_assignees a
                where a.task_id = new.task_id and a.user_id <> new.user_id) then
      raise exception 'This project allows one holder per task.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists general_task_assignees_single on public.general_task_assignees;
create trigger general_task_assignees_single
  before insert on public.general_task_assignees
  for each row execute function public.guard_general_task_single_holder();

commit;
