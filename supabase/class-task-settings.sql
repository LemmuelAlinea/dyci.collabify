-- Per-project class task settings and task relationships. Run after class-schedule.sql.
begin;

alter table public.projects
  add column if not exists task_types text[] not null default '{}',
  add column if not exists default_priority text not null default 'normal',
  add column if not exists default_stage int not null default 0,
  add column if not exists allow_subtasks boolean not null default true,
  add column if not exists allow_dependencies boolean not null default true,
  add column if not exists allow_multiple_assignees boolean not null default true,
  add column if not exists require_assignee boolean not null default false,
  add column if not exists require_subtasks_done boolean not null default true;

do $$ begin
  alter table public.projects add constraint projects_default_priority_valid
    check (default_priority in ('low', 'normal', 'high', 'urgent'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_default_stage_valid
    check (default_stage >= 0 and default_stage < public.stage_count(stages) - 1
      and (not require_assignee or default_stage = 0));
exception when duplicate_object then null; end $$;

create or replace function public.guard_class_task_settings()
returns trigger language plpgsql set search_path = public as $$
declare name text; seen text[] := '{}';
begin
  if new.default_stage >= public.stage_count(new.stages) - 1 or new.require_assignee then
    new.default_stage := case when new.require_assignee then 0
      else greatest(0, public.stage_count(new.stages) - 2) end;
  end if;
  if auth.uid() is not null and tg_op = 'UPDATE' and (
    new.task_types is distinct from old.task_types or
    new.default_priority is distinct from old.default_priority or
    new.default_stage is distinct from old.default_stage or
    new.allow_subtasks is distinct from old.allow_subtasks or
    new.allow_dependencies is distinct from old.allow_dependencies or
    new.allow_multiple_assignees is distinct from old.allow_multiple_assignees or
    new.require_assignee is distinct from old.require_assignee or
    new.require_subtasks_done is distinct from old.require_subtasks_done
  ) and not public.is_class_professor(new.class_id) then
    raise exception 'Only a professor changes task settings.' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(new.task_types) > 20 then
    raise exception 'Keep at most 20 custom task types.' using errcode = 'check_violation';
  end if;
  foreach name in array new.task_types loop
    if name is null or name <> btrim(name) or char_length(name) not between 1 and 40
       or lower(name) = 'task' or lower(name) = any(seen) then
      raise exception 'Use distinct task type names of 1 to 40 characters, apart from Task.'
        using errcode = 'check_violation';
    end if;
    seen := array_append(seen, lower(name));
  end loop;
  return new;
end $$;
drop trigger if exists projects_task_settings_guard on public.projects;
create trigger projects_task_settings_guard before insert or update of
  stages, task_types, default_priority, default_stage, allow_subtasks, allow_dependencies,
  allow_multiple_assignees, require_assignee, require_subtasks_done
  on public.projects for each row execute function public.guard_class_task_settings();

alter table public.project_tasks
  add column if not exists task_type text not null default 'Task',
  add column if not exists priority text not null default 'normal',
  add column if not exists parent_id uuid references public.project_tasks(id) on delete cascade;
do $$ begin
  alter table public.project_tasks add constraint project_tasks_priority_valid
    check (priority in ('low', 'normal', 'high', 'urgent'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.project_tasks add constraint project_tasks_parent_not_self check (parent_id <> id);
exception when duplicate_object then null; end $$;
create index if not exists project_tasks_parent_idx on public.project_tasks(parent_id)
  where parent_id is not null;

create table if not exists public.class_task_dependencies (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  depends_on_id uuid not null references public.project_tasks(id) on delete cascade,
  board_id uuid not null references public.project_boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint class_task_dependencies_not_self check (task_id <> depends_on_id)
);
create index if not exists class_task_dependencies_depends_idx
  on public.class_task_dependencies(depends_on_id);
alter table public.class_task_dependencies enable row level security;
drop policy if exists class_task_dependencies_select on public.class_task_dependencies;
create policy class_task_dependencies_select on public.class_task_dependencies
  for select to authenticated using (public.can_see_board(board_id));
revoke all on public.class_task_dependencies from public, anon, authenticated;
grant select on public.class_task_dependencies to authenticated;

create or replace function public.class_task_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype;
begin
  select p0.* into p from public.projects p0 join public.project_boards b on b.project_id = p0.id
    where b.id = new.board_id;
  if new.priority is null then new.priority := p.default_priority; end if;
  if new.stage is null then new.stage := p.default_stage; end if;
  return new;
end $$;
alter table public.project_tasks alter column priority drop default;
drop trigger if exists project_tasks_0_defaults on public.project_tasks;
create trigger project_tasks_0_defaults before insert on public.project_tasks
  for each row execute function public.class_task_defaults();

create or replace function public.guard_class_task_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype; parent public.project_tasks%rowtype;
begin
  select p0.* into p from public.projects p0 join public.project_boards b on b.project_id = p0.id
    where b.id = new.board_id;
  if tg_op = 'INSERT' or new.task_type is distinct from old.task_type then
    if new.task_type <> 'Task' and not (new.task_type = any(p.task_types)) then
      raise exception 'Choose a task type from this project.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_board_professor(old.board_id)
     and (new.task_type is distinct from old.task_type or new.priority is distinct from old.priority
       or new.parent_id is distinct from old.parent_id) and old.status <> 'todo' then
    raise exception 'This task has already been started, so it can no longer be edited.'
      using errcode = 'check_violation';
  end if;
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if not p.allow_subtasks then
      raise exception 'Subtasks are off for this project.' using errcode = 'check_violation';
    end if;
    select * into parent from public.project_tasks where id = new.parent_id;
    if parent.id is null or parent.board_id <> new.board_id or parent.parent_id is not null
       or (tg_op = 'UPDATE' and exists
         (select 1 from public.project_tasks c where c.parent_id = new.id)) then
      raise exception 'Choose a top-level task on this board.' using errcode = 'check_violation';
    end if;
    if p.require_subtasks_done and parent.status = 'done' and new.status <> 'done' then
      raise exception 'Reopen the parent before adding unfinished subtasks.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and p.require_subtasks_done and new.parent_id is not null
     and old.status = 'done' and new.status <> 'done'
     and exists (select 1 from public.project_tasks par where par.id = new.parent_id and par.status = 'done') then
    raise exception 'Reopen the parent before reopening a subtask.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done'
     and exists (select 1 from public.class_task_dependencies d
       join public.project_tasks waiting on waiting.id = d.task_id
       where d.depends_on_id = new.id and waiting.status = 'done') then
    raise exception 'Reopen the tasks that depend on this one first.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' then
    if p.require_subtasks_done and exists
      (select 1 from public.project_tasks c where c.parent_id = new.id and c.status <> 'done') then
      raise exception 'Finish the subtasks first.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.class_task_dependencies d
      join public.project_tasks t on t.id = d.depends_on_id
      where d.task_id = new.id and t.status <> 'done') then
      raise exception 'Finish the tasks this depends on first.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and p.require_assignee and new.status <> 'todo'
     and old.status = 'todo' and not exists
       (select 1 from public.task_assignees a where a.task_id = new.id) then
    raise exception 'Assign someone before work starts.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists project_tasks_b_rules on public.project_tasks;
create trigger project_tasks_b_rules before insert or update of
  task_type, priority, parent_id, status, stage on public.project_tasks
  for each row execute function public.guard_class_task_rules();

create or replace function public.guard_class_task_holder_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('class_task_holders:' || new.task_id::text, 0));
  if exists (select 1 from public.project_tasks t join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id where t.id = new.task_id
      and not p.allow_multiple_assignees)
     and exists (select 1 from public.task_assignees a where a.task_id = new.task_id) then
    raise exception 'This project allows one holder per task.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists task_assignees_holder_count on public.task_assignees;
create trigger task_assignees_holder_count before insert on public.task_assignees
  for each row execute function public.guard_class_task_holder_count();

create or replace function public.set_class_task_dependency(p_task uuid, p_depends_on uuid, p_add boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a public.project_tasks%rowtype; b public.project_tasks%rowtype; allowed boolean;
begin
  select * into a from public.project_tasks where id = p_task;
  select * into b from public.project_tasks where id = p_depends_on;
  if a.id is null or b.id is null or a.board_id <> b.board_id or a.id = b.id then
    raise exception 'Choose another task on this board.' using errcode = 'check_violation';
  end if;
  if not (public.is_board_professor(a.board_id) or public.is_board_member(a.board_id)) then
    raise exception 'Only this board can change its tasks.' using errcode = 'insufficient_privilege';
  end if;
  if public.board_project_locked(a.board_id) or public.board_submitted(a.board_id)
     or a.archived_at is not null then
    raise exception 'This board cannot change task dependencies now.' using errcode = 'check_violation';
  end if;
  if not public.is_board_professor(a.board_id) and a.status <> 'todo' then
    raise exception 'This task has already been started.' using errcode = 'check_violation';
  end if;
  if not p_add then
    delete from public.class_task_dependencies where task_id = p_task and depends_on_id = p_depends_on;
    return;
  end if;
  select p.allow_dependencies into allowed from public.projects p join public.project_boards x
    on x.project_id = p.id where x.id = a.board_id;
  if not allowed then raise exception 'Dependencies are off for this project.' using errcode = 'check_violation'; end if;
  if a.status = 'done' and b.status <> 'done' then
    raise exception 'Reopen this task before adding an unfinished dependency.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('class_task_dependencies:' || a.board_id::text, 0));
  if exists (
    with recursive chain(id) as (
      select depends_on_id from public.class_task_dependencies where task_id = p_depends_on
      union
      select d.depends_on_id from public.class_task_dependencies d join chain c on d.task_id = c.id
    ) select 1 from chain where id = p_task
  ) then raise exception 'Task dependencies cannot form a loop.' using errcode = 'check_violation'; end if;
  insert into public.class_task_dependencies(task_id, depends_on_id, board_id)
    values (p_task, p_depends_on, a.board_id) on conflict do nothing;
end $$;

create or replace function public.create_professor_task(
  p_project uuid, p_title text, p_details text, p_weight int, p_due_at timestamptz,
  p_board uuid, p_ai boolean, p_type text, p_priority text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare proj public.projects%rowtype; origin uuid := gen_random_uuid(); made int;
begin
  select * into proj from public.projects where id = p_project;
  if proj.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.is_class_professor(proj.class_id) then return jsonb_build_object('result', 'not_allowed'); end if;
  if btrim(coalesce(p_title, '')) = '' then return jsonb_build_object('result', 'no_title'); end if;
  perform public.ensure_project_boards(p_project);
  insert into public.project_tasks
    (board_id, origin_id, title, details, weight, due_at, position,
     created_by, author_role, ai_generated, task_type, priority)
  select b.id, origin, btrim(p_title), coalesce(p_details, ''),
    greatest(1, least(100, coalesce(p_weight, 1))), p_due_at,
    coalesce((select max(t.position) + 1 from public.project_tasks t where t.board_id = b.id), 1),
    auth.uid(), 'professor', coalesce(p_ai, false), coalesce(p_type, 'Task'),
    coalesce(p_priority, proj.default_priority)
  from public.project_boards b where b.project_id = p_project and (p_board is null or b.id = p_board);
  get diagnostics made = row_count;
  return jsonb_build_object('result', 'created', 'origin_id', origin, 'boards', made);
end $$;

create or replace function public.update_professor_task(
  p_origin uuid, p_title text, p_details text, p_weight int, p_due_at timestamptz,
  p_type text, p_priority text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare cls uuid; changed int; frozen int;
begin
  select public.board_class(t.board_id) into cls from public.project_tasks t
    where t.origin_id = p_origin limit 1;
  if cls is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.is_class_professor(cls) then return jsonb_build_object('result', 'not_allowed'); end if;
  update public.project_tasks set title = btrim(p_title), details = coalesce(p_details, ''),
    weight = greatest(1, least(100, coalesce(p_weight, 1))), due_at = p_due_at,
    starts_at = case when p_due_at is not null and starts_at > p_due_at then null else starts_at end,
    task_type = coalesce(p_type, task_type), priority = coalesce(p_priority, priority)
    where origin_id = p_origin and status = 'todo';
  get diagnostics changed = row_count;
  select count(*) into frozen from public.project_tasks where origin_id = p_origin and status <> 'todo';
  return jsonb_build_object('result', 'updated', 'changed', changed, 'frozen', frozen);
end $$;

drop view if exists public.task_detail_overview;
create view public.task_detail_overview with (security_invoker = true) as
select t.*, b.project_id, b.group_id,
  (select count(*) from public.task_comments c where c.task_id = t.id)::int as comment_count,
  (select count(*) from public.task_files f where f.task_id = t.id)::int as file_count,
  (select coalesce(sum(w.minutes), 0) from public.task_worklog w where w.task_id = t.id)::int as logged_minutes,
  p.first_name || ' ' || p.last_name as creator_name
from public.project_tasks t join public.project_boards b on b.id = t.board_id
left join public.profiles p on p.id = t.created_by;
revoke all on public.task_detail_overview from public, anon;
grant select on public.task_detail_overview to authenticated;

revoke all on function public.guard_class_task_settings(), public.class_task_defaults(),
  public.guard_class_task_rules(), public.guard_class_task_holder_count() from public, anon, authenticated;
revoke all on function public.set_class_task_dependency(uuid, uuid, boolean),
  public.create_professor_task(uuid,text,text,int,timestamptz,uuid,boolean,text,text),
  public.update_professor_task(uuid,text,text,int,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.set_class_task_dependency(uuid, uuid, boolean),
  public.create_professor_task(uuid,text,text,int,timestamptz,uuid,boolean,text,text),
  public.update_professor_task(uuid,text,text,int,timestamptz,text,text) to authenticated;
commit;
