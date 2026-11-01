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
--     general_tasks_a_stage (and its QA gate) and general_tasks_zz_qa_entered
--     don't run for it; this trigger sets the matching status and
--     qa_entered_at itself, and general_default_stage keeps the stage it uses
--     at or before the QA stage while the project has active QA, and before
--     the last stage always, so no task enters the work past QA or as Done. A
--     default_stage past the last stage falls back to the first. When the
--     project requires a holder and the task has none, it stays in the first
--     stage.
--   general_tasks_b_rules  after general_tasks_a_stage, so it sees the status
--     synced from the stage (the last stage is Done, the first To do). Parent
--     rules everywhere; on work projects who may link a subtask (the project
--     manager, a coordinator, a function that sets collabify.subtask_op, or
--     the service role), the parent's release state, the subtask switch, the
--     holder rule and the completion rule. Every path to Done passes it: a
--     status-only update, a stage move and qa_pass_general_task.
--   general_task_assignees_single  one holder per task when the project turns
--     allow_multiple_assignees off. Tasks that already have several keep them.
--   general_tasks_c_follow_parent  after a parent's routing_state changes (a
--     send, a review or a return), its subtasks take the same state, reviewer
--     and send time; released ones join the parent's team, and ones going back
--     to planning lose their holders, as planning work is unheld. Each move is
--     in the subtask's history.
--   general_tasks_subtask_state  a deferred constraint trigger: at commit, a
--     subtask's routing_state matches its parent's, so a subtask can't be sent
--     or returned on its own (sending it with its parent is fine).
--
-- The holder rule only stops forward moves (to a later stage, or out of To do);
-- moving back is always allowed. Releasing an unheld task that sits past the
-- first stage while the project requires a holder puts it in the first stage.
--
-- Dependencies: general_task_dependencies (task_id waits for depends_on_id),
-- both in one work project (a composite key onto general_tasks (id,
-- project_id)), no self-links, no loops. Written only through
-- add_general_task_dependency and remove_general_task_dependency (planners,
-- the lead of the task's team, the task's holders); a row is readable when
-- both tasks are, so the release boundary holds. general_tasks_b_rules refuses
-- Done while a task it waits for isn't Done (archived and trashed blockers
-- don't count), naming the blocker only to someone who can read it.
--
-- create_general_subtask adds a subtask for the project manager, a
-- coordinator, the lead of the parent's team or a holder of the parent. The
-- insert guard (general_tasks_guard) keeps every signed-in insert in private
-- planning, so after its own checks the function inserts with the request's
-- JWT claims cleared (as the service role would), created_by set to the
-- caller, and restores them straight after; the history's created event is
-- then given the caller as its actor.
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

-- ---------------------------------------------------------------- dependencies

-- task_id waits for depends_on_id. The composite keys keep both tasks in the
-- row's project; a task leaving its project is refused while it has links.
create table if not exists public.general_task_dependencies (
  task_id       uuid not null,
  depends_on_id uuid not null,
  project_id    uuid not null references public.general_projects (id) on delete cascade,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint general_task_dependencies_not_self check (task_id <> depends_on_id),
  constraint general_task_dependencies_task foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade,
  constraint general_task_dependencies_depends_on foreign key (depends_on_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);
create index if not exists general_task_dependencies_depends_on
  on public.general_task_dependencies (depends_on_id);
create index if not exists general_task_dependencies_project
  on public.general_task_dependencies (project_id);

/** Both tasks of a link are ones the caller reads (the release boundary included). */
create or replace function public.general_task_link_readable(p_task uuid, p_depends_on uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) = 2
    from public.general_tasks t
   where t.id in (p_task, p_depends_on)
     and t.trashed_at is null
     and public.general_task_child_readable(t.id)
     and not public.general_task_hidden(t.id);
$$;

alter table public.general_task_dependencies enable row level security;
drop policy if exists general_task_dependencies_select on public.general_task_dependencies;
create policy general_task_dependencies_select on public.general_task_dependencies
  for select to authenticated
  using (public.general_task_link_readable(task_id, depends_on_id));
revoke all on table public.general_task_dependencies from public, anon, authenticated;
grant select on table public.general_task_dependencies to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.general_task_dependencies;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- no realtime publication on this database
  end;
  alter table public.general_task_dependencies replica identity full;
end $$;

-- ---------------------------------------------------------------- defaults

/**
 * The stage, 0-based, a task enters the work in, for a stage list of p_n
 * stages: the project's default, the first when that is past the last stage,
 * never the last stage itself (Done), and never past p_qa, the QA stage of a
 * project with active QA (null without).
 */
create or replace function public.general_default_stage(p_default int, p_n int, p_qa int)
returns int language sql immutable set search_path = public as $$
  select greatest(0, least(case when p_default between 0 and p_n - 1 then p_default else 0 end,
                           p_n - 2,
                           coalesce(p_qa, p_n)))
$$;

/** Fills a new task's priority and starts work in the project's default stage. */
create or replace function public.apply_general_task_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gp   public.general_projects%rowtype;
  n    int;
  d    int;
  held boolean;
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
  held := exists (select 1 from public.general_task_assignees a where a.task_id = new.id);

  -- Unheld work that sat past the first stage in planning restarts there when
  -- the project requires a holder (the send clears holders first).
  if tg_op = 'UPDATE' and gp.require_assignee and not held
     and new.routing_state = 'released'
     and old.routing_state is distinct from 'released'
     and (new.status, new.stage) is not distinct from (old.status, old.stage)
     and public.general_task_stage_at(old.status, old.stage, n) > 0 then
    new.stage := 0;
    new.status := 'todo';
    new.qa_entered_at := null;
    new.completed_at := null;
    return new;
  end if;

  d := public.general_default_stage(gp.default_stage, n,
         case when public.general_project_has_qa(gp.id)
              then public.general_qa_stage_pick(gp.stages, gp.qa_stage) end);
  -- A required holder comes first: unheld work waits in the first stage.
  if d = 0 or (gp.require_assignee and not held) then
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
    new.status := 'in_progress';  -- d is never the first or the last stage
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
 * only the project manager, a coordinator, a function that sets
 * collabify.subtask_op, or the service role links or unlinks a subtask; a
 * subtask shares its parent's release state; no new subtasks while the switch
 * is off, no released task moves forward past the first
 * stage without a holder when one is required, no parent reaches Done
 * (by status or the last stage) while a subtask is open, and no task reaches
 * Done while a task it waits for is open. Archived and trashed subtasks and
 * blockers don't hold a task back.
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
  blk     record;
begin
  select * into gp from public.general_projects where id = new.project_id;

  if gp.class_board_id is null and auth.uid() is not null
     and (case when tg_op = 'INSERT' then new.parent_id is not null
               else new.parent_id is distinct from old.parent_id end)
     and coalesce(current_setting('collabify.subtask_op', true), 'off') <> 'on'
     and not coalesce(public.general_role_of(new.project_id, auth.uid()) in ('pm', 'coordinator'),
                      false) then
    raise exception 'Add subtasks from the parent task.' using errcode = 'insufficient_privilege';
  end if;

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
    -- general_tasks_guard, after this, keeps a signed-in insert in planning.
    if gp.class_board_id is null
       and par.routing_state is distinct from
           (case when tg_op = 'INSERT' and auth.uid() is not null then 'planning'
                 else new.routing_state end) then
      raise exception 'A subtask must share its parent''s release state.'
        using errcode = 'check_violation';
    end if;
  end if;

  if gp.id is null or gp.class_board_id is not null then
    return new;
  end if;

  n := public.stage_count(gp.stages);
  idx := public.general_task_stage_at(new.status, new.stage, n);

  -- Planning tasks stay unheld. Released work past the first stage needs a
  -- holder when it enters the work there or moves forward; moving back is free.
  if gp.require_assignee and new.routing_state = 'released' and idx > 0 then
    if tg_op = 'INSERT' or old.routing_state is distinct from 'released' then
      moved := true;
    else
      old_idx := public.general_task_stage_at(old.status, old.stage, n);
      moved := idx > old_idx;
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

  -- A task waits for its dependencies to be done. A blocker the caller can't
  -- read (private planning work) isn't named; a readable one is named first.
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done' then
    select b.id, b.title,
           (auth.uid() is null or public.general_task_child_readable(b.id)) as seen
      into blk
      from public.general_task_dependencies d
      join public.general_tasks b on b.id = d.depends_on_id
     where d.task_id = new.id and b.status <> 'done'
       and b.archived_at is null and b.trashed_at is null
     order by 3 desc, b.title, b.id
     limit 1;
    if found then
      if blk.seen then
        raise exception 'Waiting for %. Finish it first.', blk.title using errcode = 'check_violation';
      end if;
      raise exception 'Waiting for a task you can''t see yet. Ask the project manager about it.'
        using errcode = 'check_violation';
    end if;
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

-- ---------------------------------------------------------------- subtasks follow their parent

/**
 * A parent's send, review or return carries its subtasks along. Runs under the
 * handoff that changed the parent; the flags let the guards treat the subtask
 * update as part of that handoff (an archived subtask included).
 */
create or replace function public.follow_general_task_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c         record;
  holders   uuid[];
  prior_ho  text := current_setting('collabify.work_task_handoff', true);
  prior_sub text := current_setting('collabify.subtask_op', true);
  prior_arc text := current_setting('collabify.general_archive_op', true);
begin
  if new.routing_state is not distinct from old.routing_state
     or not exists (select 1 from public.general_tasks x where x.parent_id = new.id)
     or exists (select 1 from public.general_projects p
                 where p.id = new.project_id and p.class_board_id is not null) then
    return null;
  end if;

  perform set_config('collabify.work_task_handoff', 'on', true);
  perform set_config('collabify.subtask_op', 'on', true);
  perform set_config('collabify.general_archive_op', 'on', true);
  for c in
    select x.id, x.team_id from public.general_tasks x
     where x.parent_id = new.id and x.routing_state is distinct from new.routing_state
     order by x.id
       for update
  loop
    holders := '{}';
    if new.routing_state <> 'released' then
      select coalesce(array_agg(a.user_id order by a.user_id), '{}') into holders
        from public.general_task_assignees a where a.task_id = c.id;
      delete from public.general_task_assignees where task_id = c.id;
    end if;
    update public.general_tasks
       set routing_state = new.routing_state,
           reviewer_id   = new.reviewer_id,
           sent_at       = new.sent_at,
           team_id       = case when new.routing_state = 'released' then new.team_id else team_id end
     where id = c.id;
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (c.id, new.project_id, auth.uid(),
            case new.routing_state when 'released' then 'sent_to_team'
                                   when 'coordinator_review' then 'sent_to_coordinator'
                                   else 'returned' end,
            jsonb_build_object('actor_id', auth.uid(), 'old_team_id', c.team_id,
              'new_team_id', case when new.routing_state = 'released' then new.team_id else c.team_id end,
              'reviewer_id', new.reviewer_id, 'reason', null,
              'former_holder_ids', to_jsonb(holders), 'parent_id', new.id)
            || case when new.routing_state = 'planning'
                    then jsonb_build_object('return_source', 'parent') else '{}'::jsonb end);
  end loop;
  perform set_config('collabify.work_task_handoff', coalesce(nullif(prior_ho, ''), 'off'), true);
  perform set_config('collabify.subtask_op', coalesce(nullif(prior_sub, ''), 'off'), true);
  perform set_config('collabify.general_archive_op', coalesce(nullif(prior_arc, ''), 'off'), true);
  return null;
end;
$$;

drop trigger if exists general_tasks_c_follow_parent on public.general_tasks;
create trigger general_tasks_c_follow_parent
  after update of routing_state on public.general_tasks
  for each row execute function public.follow_general_task_parent();

/** At commit, a subtask shares its parent's release state. */
create or replace function public.check_general_subtask_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.general_tasks%rowtype;
begin
  select * into c from public.general_tasks where id = new.id;
  if c.id is null or c.parent_id is null
     or exists (select 1 from public.general_projects p
                 where p.id = c.project_id and p.class_board_id is not null) then
    return null;
  end if;
  if (select x.routing_state from public.general_tasks x where x.id = c.parent_id)
     is distinct from c.routing_state then
    raise exception 'Send or return the parent task. Its subtasks move with it.'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists general_tasks_subtask_state on public.general_tasks;
create constraint trigger general_tasks_subtask_state
  after insert or update of routing_state, parent_id on public.general_tasks
  deferrable initially deferred
  for each row execute function public.check_general_subtask_state();

-- ---------------------------------------------------------------- who edits a task's links

/**
 * The caller may change what a task waits for: the project manager or a
 * coordinator, the lead of the released task's team, or one of its holders.
 */
create or replace function public.general_task_links_editable(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t
     where t.id = p_task
       and (coalesce(public.general_role_of(t.project_id, auth.uid()) in ('pm', 'coordinator'), false)
            or (t.routing_state = 'released' and exists (
                  select 1 from public.general_teams g
                    join public.general_team_members tm
                      on tm.team_id = g.id and tm.project_id = t.project_id and tm.user_id = auth.uid()
                   where g.id = t.team_id and g.project_id = t.project_id
                     and g.leader_id = auth.uid() and g.archived_at is null))
            or exists (select 1 from public.general_task_assignees a
                        where a.task_id = t.id and a.user_id = auth.uid()))
  );
$$;

/**
 * The checks every link change shares: a signed-in, writing member of a live
 * work project who may edit the waiting task. Returns the task's project.
 */
create or replace function public.general_task_links_check(p_task uuid)
returns public.general_projects
language plpgsql stable security definer set search_path = public as $$
declare
  t  public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
begin
  select * into t from public.general_tasks where id = p_task;
  if t.id is null then
    raise exception 'Choose two tasks in this project.' using errcode = 'check_violation';
  end if;
  select * into gp from public.general_projects where id = t.project_id;
  if gp.class_board_id is not null then
    raise exception 'Dependencies are for work projects.' using errcode = 'check_violation';
  end if;
  if auth.uid() is null or public.general_role_of(gp.id, auth.uid()) is null then
    raise exception 'You are not on this project.' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(gp.id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(gp.id) then
    raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
  end if;
  if not public.general_task_links_editable(t.id) then
    raise exception 'Only the project manager, a coordinator, the team''s lead or whoever holds the task can link it.'
      using errcode = 'insufficient_privilege';
  end if;
  if t.archived_at is not null or t.trashed_at is not null then
    raise exception 'Restore the task before changing what it waits for.'
      using errcode = 'check_violation';
  end if;
  return gp;
end;
$$;

/** p_task waits for p_depends_on. Adding a link that exists changes nothing. */
create or replace function public.add_general_task_dependency(p_task uuid, p_depends_on uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.general_projects%rowtype;
  b  public.general_tasks%rowtype;
begin
  if p_task = p_depends_on then
    raise exception 'A task can''t wait for itself.' using errcode = 'check_violation';
  end if;
  select * into b from public.general_tasks where id = p_depends_on;
  if b.id is null then
    raise exception 'Choose two tasks in this project.' using errcode = 'check_violation';
  end if;
  if b.project_id is distinct from (select t.project_id from public.general_tasks t where t.id = p_task) then
    raise exception 'Both tasks must be in the same project.' using errcode = 'check_violation';
  end if;
  gp := public.general_task_links_check(p_task);
  if not public.general_task_link_readable(p_task, p_depends_on) then
    raise exception 'Choose two tasks you can see.' using errcode = 'check_violation';
  end if;
  if b.archived_at is not null then
    raise exception 'Restore the task before changing what it waits for.'
      using errcode = 'check_violation';
  end if;
  if not gp.allow_dependencies then
    raise exception 'Dependencies are turned off for this project.' using errcode = 'check_violation';
  end if;

  -- One link change at a time per project, so two links can't close a loop together.
  perform pg_advisory_xact_lock(hashtextextended('general_task_dependencies:' || gp.id::text, 0));
  if exists (
    with recursive chain (id) as (
      select d.depends_on_id from public.general_task_dependencies d where d.task_id = p_depends_on
      union
      select d.depends_on_id from public.general_task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = p_task
  ) then
    raise exception 'That link would make these tasks wait on each other.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_task_dependencies (task_id, depends_on_id, project_id, created_by)
  values (p_task, p_depends_on, gp.id, auth.uid())
  on conflict (task_id, depends_on_id) do nothing;
end;
$$;

/** p_task stops waiting for p_depends_on. Works while dependencies are off. */
create or replace function public.remove_general_task_dependency(p_task uuid, p_depends_on uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.general_task_links_check(p_task);
  delete from public.general_task_dependencies
   where task_id = p_task and depends_on_id = p_depends_on;
end;
$$;

-- ---------------------------------------------------------------- adding a subtask

/**
 * Adds a subtask under p_parent for the project manager, a coordinator, the
 * lead of the parent's team or a holder of the parent. It lands in the
 * parent's team, sprint (unless that sprint is finished), milestone and
 * release state, with the project's default priority. Returns its id.
 */
create or replace function public.create_general_subtask(
  p_parent uuid, p_title text, p_description text default '', p_due_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  par      public.general_tasks%rowtype;
  gp       public.general_projects%rowtype;
  v_role   public.general_role;
  v_title  text := btrim(coalesce(p_title, ''));
  v_sprint uuid;
  v_id     uuid;
  -- Restored after the insert, so the caller's session is as it was.
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
  prior_op     text := current_setting('collabify.subtask_op', true);
begin
  if me is null then
    raise exception 'Sign in to add a subtask.' using errcode = 'insufficient_privilege';
  end if;
  -- Locked so the parent can't be finished or nested meanwhile.
  select * into par from public.general_tasks where id = p_parent for share;
  if par.id is null then
    raise exception 'Choose a task to add the subtask to.' using errcode = 'check_violation';
  end if;
  select * into gp from public.general_projects where id = par.project_id;
  if gp.class_board_id is not null then
    raise exception 'Subtasks are for work projects.' using errcode = 'check_violation';
  end if;
  v_role := public.general_role_of(gp.id, me);
  if v_role is null then
    raise exception 'You are not on this project.' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(gp.id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(gp.id) then
    raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
  end if;
  if not (v_role in ('pm', 'coordinator')
          or (par.routing_state = 'released' and public.general_task_links_editable(par.id))) then
    raise exception 'Only the project manager, a coordinator, the team''s lead or whoever holds the task can add a subtask.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'qa' then
    raise exception 'QA creates bug tasks only.' using errcode = 'insufficient_privilege';
  end if;
  if par.archived_at is not null or par.trashed_at is not null then
    raise exception 'Restore the task before adding a subtask.' using errcode = 'check_violation';
  end if;
  if par.parent_id is not null then
    raise exception 'A subtask can''t have its own subtasks.' using errcode = 'check_violation';
  end if;
  if par.status = 'done' then
    raise exception 'Reopen the task before adding a subtask.' using errcode = 'check_violation';
  end if;
  if not gp.allow_subtasks then
    raise exception 'Subtasks are turned off for this project.' using errcode = 'check_violation';
  end if;
  if v_title = '' then
    raise exception 'Give the subtask a title.' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'Keep the subtask''s title to 200 characters.' using errcode = 'check_violation';
  end if;
  select s.id into v_sprint from public.general_sprints s
   where s.id = par.sprint_id and s.state <> 'completed';

  -- general_tasks_guard puts every signed-in insert in private planning, so
  -- the insert runs as the service role would; the checks above stand in.
  begin
    perform set_config('collabify.subtask_op', 'on', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into public.general_tasks
      (project_id, parent_id, title, description, due_at, team_id, sprint_id, milestone_id,
       routing_state, reviewer_id, sent_at, created_by)
    values
      (gp.id, par.id, v_title, coalesce(p_description, ''), p_due_at, par.team_id, v_sprint,
       par.milestone_id, par.routing_state, par.reviewer_id, par.sent_at, me)
    returning id into v_id;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.subtask_op', coalesce(nullif(prior_op, ''), 'off'), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.subtask_op', coalesce(nullif(prior_op, ''), 'off'), true);
    raise;
  end;

  -- The history's created event ran without claims; it names the caller.
  update public.general_task_events set actor_id = me
   where task_id = v_id and kind = 'created' and actor_id is null;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_task_link_readable(uuid, uuid) from public, anon;
grant execute on function public.general_task_link_readable(uuid, uuid) to authenticated;
revoke all on function public.add_general_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_general_task_dependency(uuid, uuid) to authenticated;
revoke all on function public.remove_general_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.remove_general_task_dependency(uuid, uuid) to authenticated;
revoke all on function public.create_general_subtask(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.create_general_subtask(uuid, text, text, timestamptz) to authenticated;
revoke all on function public.general_task_links_editable(uuid) from public, anon, authenticated;
revoke all on function public.general_task_links_check(uuid) from public, anon, authenticated;
revoke all on function public.follow_general_task_parent() from public, anon, authenticated;
revoke all on function public.check_general_subtask_state() from public, anon, authenticated;

commit;
