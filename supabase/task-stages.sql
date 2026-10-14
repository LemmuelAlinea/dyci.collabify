-- Collabify — progress stages: each project names the columns its work moves
-- through ("Planning → Development → Testing → Revision → Completed").
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/task-stages.sql
--
-- The model. A project keeps `stages`, 3 to 8 names in order; null means the
-- default To do / In progress / Done. A task keeps `stage`, its column. Status
-- stays the meaning every report, grade, lock and late check reads:
--
--   first stage        todo         (not started; still open to edits)
--   any middle stage   in_progress
--   last stage         done
--
-- So a task's status always follows from its stage, and setting only its
-- status (every older path does) puts it on the matching stage. A stored
-- stage is only trusted while the task is in progress; the app reads a todo
-- task as the first stage and a done one as the last, whatever is stored, so
-- renaming, adding or removing stages never needs to rewrite tasks.
--
-- Run after class-milestones.sql and work-milestones.sql: it recreates
-- task_detail_overview (so `t.*` picks up `stage`) and general_task_overview
-- (with `stage` appended).

begin;

-- ---------------------------------------------------------------- columns

/** True when a stage list is usable. Mirrors checkStages() in lib/stages.ts. */
create or replace function public.stages_ok(p_stages text[])
returns boolean language sql immutable as $$
  select p_stages is null or (
    coalesce(array_length(p_stages, 1), 0) between 3 and 8
    and not exists (
      select 1 from unnest(p_stages) s
       where s is null or char_length(btrim(s)) not between 1 and 40
    )
    and (select count(distinct lower(btrim(s))) from unnest(p_stages) s) = array_length(p_stages, 1)
  )
$$;

alter table public.projects add column if not exists stages text[];
alter table public.general_projects add column if not exists stages text[];

alter table public.projects drop constraint if exists projects_stages_ok;
alter table public.projects add constraint projects_stages_ok check (public.stages_ok(stages));
alter table public.general_projects drop constraint if exists general_projects_stages_ok;
alter table public.general_projects add constraint general_projects_stages_ok check (public.stages_ok(stages));

alter table public.project_tasks add column if not exists stage smallint;
alter table public.general_tasks add column if not exists stage smallint;

-- ---------------------------------------------------------------- the rule

/** How many stages a list holds; null is the default three. */
create or replace function public.stage_count(p_stages text[])
returns int language sql immutable as $$
  select coalesce(array_length(p_stages, 1), 3)
$$;

/**
 * Keeps a task's status and stage in step, given its project's stage count.
 * A stage that moved decides the status; a status that moved alone decides
 * the stage (an in-progress task keeps the middle stage it was on).
 */
create or replace function public.align_task_stage(
  p_n int,
  p_insert boolean,
  p_old_status text, p_old_stage int,
  p_status text, p_stage int,
  out status text, out stage int
) language plpgsql immutable as $$
declare
  stage_moved boolean := p_stage is not null
    and (p_insert or p_stage is distinct from p_old_stage);
  status_moved boolean := not p_insert and p_status is distinct from p_old_status;
begin
  status := p_status;
  stage := p_stage;
  if stage_moved and not status_moved then
    stage := greatest(0, least(p_n - 1, p_stage));
    status := case when stage = 0 then 'todo'
                   when stage = p_n - 1 then 'done'
                   else 'in_progress' end;
  elsif status_moved or p_insert then
    stage := case p_status
      when 'todo' then 0
      when 'done' then p_n - 1
      else case when p_stage between 1 and p_n - 2 then p_stage
                when p_old_stage between 1 and p_n - 2 then p_old_stage
                else 1 end
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------- class tasks

-- Named to sort before project_tasks_guard_edit, so the guard and the status
-- stamp both see the status the stage implies.
create or replace function public.sync_task_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  r record;
begin
  if tg_op = 'UPDATE'
     and new.stage is not distinct from old.stage
     and new.status is not distinct from old.status then
    return new;
  end if;

  select public.stage_count(p.stages) into n
    from public.project_boards b join public.projects p on p.id = b.project_id
   where b.id = new.board_id;

  -- Moving between middle stages leaves the status alone, so the guard's
  -- "only the people on this task" rule is repeated here for the stage.
  if tg_op = 'UPDATE'
     and new.stage is distinct from old.stage
     and auth.uid() is not null
     and not public.is_board_professor(old.board_id)
     and not public.is_task_assignee(old.id) then
    raise exception 'Only the people on this task can move it. Claim it first.'
      using errcode = 'check_violation';
  end if;

  select * into r from public.align_task_stage(
    coalesce(n, 3), tg_op = 'INSERT',
    case when tg_op = 'UPDATE' then old.status::text end,
    case when tg_op = 'UPDATE' then old.stage end,
    new.status::text, new.stage);
  new.status := r.status::public.task_status;
  new.stage := r.stage;
  return new;
end;
$$;

drop trigger if exists project_tasks_a_stage on public.project_tasks;
create trigger project_tasks_a_stage before insert or update of status, stage on public.project_tasks
  for each row execute function public.sync_task_stage();

-- ---------------------------------------------------------------- work tasks

create or replace function public.sync_general_task_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  r record;
begin
  if tg_op = 'UPDATE'
     and new.stage is not distinct from old.stage
     and new.status is not distinct from old.status then
    return new;
  end if;

  select public.stage_count(p.stages) into n
    from public.general_projects p where p.id = new.project_id;

  -- The same people who may change its status: whoever holds it, its creator
  -- while nobody does, or someone who manages tasks.
  if tg_op = 'UPDATE'
     and new.stage is distinct from old.stage
     and auth.uid() is not null
     and not public.general_can(old.project_id, 'manage_tasks')
     and not public.is_general_task_assignee(old.id)
     and not (old.created_by = auth.uid() and not public.general_task_held(old.id)) then
    raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
      using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.align_task_stage(
    coalesce(n, 3), tg_op = 'INSERT',
    case when tg_op = 'UPDATE' then old.status::text end,
    case when tg_op = 'UPDATE' then old.stage end,
    new.status::text, new.stage);
  new.status := r.status::public.general_task_status;
  new.stage := r.stage;
  return new;
end;
$$;

drop trigger if exists general_tasks_a_stage on public.general_tasks;
create trigger general_tasks_a_stage before insert or update of status, stage on public.general_tasks
  for each row execute function public.sync_general_task_stage();

-- ---------------------------------------------------------------- the overviews

-- As class-milestones.sql; recreated so `t.*` includes `stage`.
drop view if exists public.task_detail_overview;

create view public.task_detail_overview
with (security_invoker = true) as
select t.*,
       b.project_id,
       b.group_id,
       (select count(*) from public.task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.task_files f where f.task_id = t.id)::int
         as file_count,
       (select coalesce(sum(w.minutes), 0) from public.task_worklog w where w.task_id = t.id)::int
         as logged_minutes,
       p.first_name || ' ' || p.last_name as creator_name
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
  left join public.profiles p on p.id = t.created_by;

grant select on public.task_detail_overview to authenticated;

-- As work-milestones.sql, with `stage` appended.
drop view if exists public.general_task_overview;

create view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce((select array_agg(a.user_id order by a.assigned_at)
                   from public.general_task_assignees a where a.task_id = t.id), '{}'::uuid[])
         as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.general_task_files f
         where f.task_id = t.id and f.archived_at is null)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at,
       t.archived_at,
       t.archived_by,
       t.sprint_id,
       t.rank,
       t.milestone_id,
       t.stage
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

revoke all on public.task_detail_overview, public.general_task_overview from anon;

commit;
