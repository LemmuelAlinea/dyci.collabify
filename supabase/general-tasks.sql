-- Collabify — tasks in the General workplace.
--
--   node scripts/db.mjs supabase/general-tasks.sql
--
-- The same shape of work as an Education board — assignees, comments, files, a
-- time log and a history — without the rules that only make sense in a class:
-- no deadline lock, no hand-in, no professor-approved reassignment. Anyone with
-- `manage_tasks` moves work between people directly.
--
-- Points are a project setting. `weight` is always stored (default 1); whether
-- it matters is `general_projects.points_enabled`.
--
-- Requires supabase/general.sql.

begin;

do $$ begin
  create type public.general_task_status as enum ('todo', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  team_id      uuid,
  title        text not null,
  description  text not null default '',
  status       public.general_task_status not null default 'todo',
  due_at       timestamptz,
  weight       numeric(8, 2) not null default 1,
  created_by   uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint general_tasks_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint general_tasks_description_len check (char_length(description) <= 20000),
  constraint general_tasks_weight check (weight > 0 and weight <= 1000),
  constraint general_tasks_id_project unique (id, project_id),
  -- Removing a team leaves its tasks on the project rather than deleting them.
  -- The column list on SET NULL needs Postgres 15 or later.
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete set null (team_id)
);

create index if not exists general_tasks_project_idx on public.general_tasks (project_id, status);
create index if not exists general_tasks_due_idx
  on public.general_tasks (due_at) where status <> 'done' and due_at is not null;

drop trigger if exists general_tasks_touch on public.general_tasks;
create trigger general_tasks_touch before update on public.general_tasks
  for each row execute function public.touch_updated_at();

create table if not exists public.general_task_assignees (
  task_id     uuid not null,
  project_id  uuid not null,
  user_id     uuid not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create index if not exists general_task_assignees_user_idx on public.general_task_assignees (user_id);

create table if not exists public.general_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  constraint general_task_comments_body_len check (char_length(btrim(body)) between 1 and 5000),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_comments_task_idx
  on public.general_task_comments (task_id, created_at);

create table if not exists public.general_task_files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null,
  project_id  uuid not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_path   text not null unique,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now(),
  constraint general_task_files_name_len check (char_length(file_name) between 1 and 255),
  constraint general_task_files_size check (size_bytes between 0 and 26214400),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

-- Ties the row to the storage path it claims: <project_id>/<task_id>/<...>.
alter table public.general_task_files drop constraint if exists general_task_files_path_matches;
alter table public.general_task_files add constraint general_task_files_path_matches
  check (file_path like project_id::text || '/' || task_id::text || '/%');

create index if not exists general_task_files_task_idx on public.general_task_files (task_id);

create table if not exists public.general_task_logs (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  minutes    int not null,
  note       text not null default '',
  logged_on  date not null default current_date,
  created_at timestamptz not null default now(),
  constraint general_task_logs_minutes check (minutes between 1 and 1440),
  constraint general_task_logs_note_len check (char_length(note) <= 2000),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_logs_task_idx on public.general_task_logs (task_id);

-- Append-only, written by triggers. Nobody has a write policy on it.
create table if not exists public.general_task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint general_task_events_kind check (kind in ('created', 'updated', 'assigned', 'unassigned')),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_events_task_idx
  on public.general_task_events (task_id, created_at);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_general_task_assignee(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_task_assignees
     where task_id = p_task and user_id = auth.uid()
  );
$$;

create or replace function public.general_task_held(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.general_task_assignees where task_id = p_task);
$$;

create or replace function public.general_task_project(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.general_tasks where id = p_task;
$$;

-- These read task/assignee facts as the definer, so anon must not call them
-- directly — only through policies evaluated for a signed-in user.
revoke execute on function
  public.is_general_task_assignee(uuid), public.general_task_held(uuid),
  public.general_task_project(uuid)
from public, anon;
grant execute on function
  public.is_general_task_assignee(uuid), public.general_task_held(uuid),
  public.general_task_project(uuid)
to authenticated;

/** Parses a storage path segment as a uuid, or null rather than throwing on garbage. */
create or replace function public.general_safe_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception
  when others then return null;
end;
$$;

-- ---------------------------------------------------------------- guards

create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if not public.is_general_member(v_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if public.general_is_archived(old.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if not public.general_can(old.project_id, 'manage_tasks') then
    if not (public.is_general_task_assignee(old.id)
            or (old.created_by = auth.uid() and not public.general_task_held(old.id))) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_guard on public.general_tasks;
create trigger general_tasks_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task();

/** Assignees, comments, files and logs: stamp the author, and freeze with the project. */
create or replace function public.guard_general_task_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  -- Leaving an archived project cascades into general_task_assignees; that
  -- delete should go through even though the membership row that drove it is
  -- already gone by the time this trigger fires.
  v_member_gone boolean := false;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'general_task_assignees' then
    v_member_gone := not exists (
      select 1 from public.general_members
       where project_id = old.project_id and user_id = old.user_id
    );
  end if;

  if not v_member_gone then
    if not public.is_general_member(p) then
      raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
    end if;
    if public.general_is_archived(p) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    case tg_table_name
      when 'general_task_assignees' then
        new.assigned_by := auth.uid();
        -- Locks the task row so two simultaneous claims cannot both see it unheld.
        perform 1 from public.general_tasks where id = new.task_id for update;
        if not public.general_can(new.project_id, 'manage_tasks')
           and public.general_task_held(new.task_id) then
          raise exception 'Somebody already holds this task' using errcode = 'check_violation';
        end if;
      when 'general_task_comments'  then new.author_id := auth.uid();
      when 'general_task_files'     then new.uploaded_by := auth.uid();
      when 'general_task_logs'      then new.user_id := auth.uid();
      else null;
    end case;
  elsif tg_op = 'UPDATE' and tg_table_name = 'general_task_comments' then
    new.author_id := old.author_id;
    new.task_id := old.task_id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_task_assignees_guard on public.general_task_assignees;
create trigger general_task_assignees_guard before insert or delete on public.general_task_assignees
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_comments_guard on public.general_task_comments;
create trigger general_task_comments_guard before insert or update or delete on public.general_task_comments
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_files_guard on public.general_task_files;
create trigger general_task_files_guard before insert or delete on public.general_task_files
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_logs_guard on public.general_task_logs;
create trigger general_task_logs_guard before insert or delete on public.general_task_logs
  for each row execute function public.guard_general_task_child();

-- ---------------------------------------------------------------- history

create or replace function public.record_general_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'created', jsonb_build_object('title', new.title));
    return new;
  end if;

  if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
  if new.description is distinct from old.description then changed := array_append(changed, 'description'); end if;
  if new.status is distinct from old.status then changed := array_append(changed, 'status'); end if;
  if new.due_at is distinct from old.due_at then changed := array_append(changed, 'due_at'); end if;
  if new.team_id is distinct from old.team_id then changed := array_append(changed, 'team_id'); end if;
  if new.weight is distinct from old.weight then changed := array_append(changed, 'weight'); end if;

  if array_length(changed, 1) > 0 then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'updated',
            jsonb_build_object('fields', to_jsonb(changed), 'status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_history on public.general_tasks;
create trigger general_tasks_history after insert or update on public.general_tasks
  for each row execute function public.record_general_task_event();

create or replace function public.record_general_assignee_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.task_id, new.project_id, auth.uid(), 'assigned',
            jsonb_build_object('user_id', new.user_id));
    return new;
  end if;
  -- A task deleted with its assignees takes its history with it; nothing to record.
  if exists (select 1 from public.general_tasks where id = old.task_id) then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (old.task_id, old.project_id, auth.uid(), 'unassigned',
            jsonb_build_object('user_id', old.user_id));
  end if;
  return old;
end;
$$;

drop trigger if exists general_task_assignees_history on public.general_task_assignees;
create trigger general_task_assignees_history after insert or delete on public.general_task_assignees
  for each row execute function public.record_general_assignee_event();

-- ---------------------------------------------------------------- row-level security

alter table public.general_tasks          enable row level security;
alter table public.general_task_assignees enable row level security;
alter table public.general_task_comments  enable row level security;
alter table public.general_task_files     enable row level security;
alter table public.general_task_logs      enable row level security;
alter table public.general_task_events    enable row level security;

drop policy if exists general_tasks_select on public.general_tasks;
create policy general_tasks_select on public.general_tasks
  for select using (public.is_general_member(project_id));

drop policy if exists general_tasks_insert on public.general_tasks;
create policy general_tasks_insert on public.general_tasks
  for insert with check (public.is_general_member(project_id));

-- Who may change which task is decided in guard_general_task, which can say why.
drop policy if exists general_tasks_update on public.general_tasks;
create policy general_tasks_update on public.general_tasks
  for update using (public.is_general_member(project_id))
  with check (public.is_general_member(project_id));

drop policy if exists general_tasks_delete on public.general_tasks;
create policy general_tasks_delete on public.general_tasks
  for delete using (
    public.general_can(project_id, 'manage_tasks')
    or (created_by = auth.uid()
        and public.is_general_member(project_id)
        and not public.general_task_held(id)
        and not public.general_is_archived(project_id))
  );

drop policy if exists general_task_assignees_select on public.general_task_assignees;
create policy general_task_assignees_select on public.general_task_assignees
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_assignees_insert on public.general_task_assignees;
create policy general_task_assignees_insert on public.general_task_assignees
  for insert with check (
    (public.general_can(project_id, 'manage_tasks')
     and exists (select 1 from public.profiles p where p.id = user_id and p.status <> 'rejected'))
    or (user_id = auth.uid()
        and public.is_general_member(project_id)
        and not public.general_task_held(task_id))
  );

drop policy if exists general_task_assignees_delete on public.general_task_assignees;
create policy general_task_assignees_delete on public.general_task_assignees
  for delete using (public.general_can(project_id, 'manage_tasks') or user_id = auth.uid());

drop policy if exists general_task_comments_select on public.general_task_comments;
create policy general_task_comments_select on public.general_task_comments
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_comments_insert on public.general_task_comments;
create policy general_task_comments_insert on public.general_task_comments
  for insert with check (author_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_task_comments_update on public.general_task_comments;
create policy general_task_comments_update on public.general_task_comments
  for update using (author_id = auth.uid() and public.is_general_member(project_id))
  with check (author_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_task_comments_delete on public.general_task_comments;
create policy general_task_comments_delete on public.general_task_comments
  for delete using (
    (author_id = auth.uid() and public.is_general_member(project_id))
    or public.general_can(project_id, 'manage_tasks')
  );

drop policy if exists general_task_files_select on public.general_task_files;
create policy general_task_files_select on public.general_task_files
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_files_insert on public.general_task_files;
create policy general_task_files_insert on public.general_task_files
  for insert with check (
    uploaded_by = auth.uid()
    and public.is_general_member(project_id)
    and (public.is_general_task_assignee(task_id) or public.general_can(project_id, 'edit_files'))
  );

drop policy if exists general_task_files_delete on public.general_task_files;
create policy general_task_files_delete on public.general_task_files
  for delete using (
    (uploaded_by = auth.uid() and public.is_general_member(project_id))
    or public.general_can(project_id, 'edit_files')
  );

drop policy if exists general_task_logs_select on public.general_task_logs;
create policy general_task_logs_select on public.general_task_logs
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_logs_insert on public.general_task_logs;
create policy general_task_logs_insert on public.general_task_logs
  for insert with check (
    user_id = auth.uid()
    and public.is_general_member(project_id)
    and public.is_general_task_assignee(task_id)
  );

drop policy if exists general_task_logs_delete on public.general_task_logs;
create policy general_task_logs_delete on public.general_task_logs
  for delete using (user_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_task_events_select on public.general_task_events;
create policy general_task_events_select on public.general_task_events
  for select using (public.is_general_member(project_id));

grant select, insert, update, delete on public.general_tasks, public.general_task_assignees,
  public.general_task_comments, public.general_task_files, public.general_task_logs to authenticated;
grant select on public.general_task_events to authenticated;

-- ---------------------------------------------------------------- views

drop view if exists public.general_project_overview;
create view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       -- RLS on general_join_codes leaves these null for anybody who cannot invite.
       (select jc.code from public.general_join_codes jc where jc.project_id = p.id) as join_code,
       coalesce((select jc.open from public.general_join_codes jc where jc.project_id = p.id), false)
         as join_open,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at,
       m.level as my_level,
       (select count(*) from public.general_members x where x.project_id = p.id)::int as member_count,
       coalesce(t.task_count, 0) as task_count,
       coalesce(t.done_count, 0) as done_count,
       -- Mirrors projectProgress() in src/lib/general/progress.ts.
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       -- RLS narrows this: an Owner counts every open request, a Member only their own.
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count
  from public.general_projects p
  join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id
  ) t on true;

grant select on public.general_project_overview to authenticated;

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
       coalesce(
         (select array_agg(a.user_id order by a.assigned_at)
            from public.general_task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int as comment_count,
       (select count(*) from public.general_task_files f where f.task_id = t.id)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes
  from public.general_tasks t;

grant select on public.general_task_overview to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit)
values ('general-files', 'general-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- Paths are <project_id>/<task_id>/<random>-<file name>. general_safe_uuid
-- returns null rather than throwing on a malformed segment, so a bad path is
-- just refused instead of erroring the request.
drop policy if exists general_files_read on storage.objects;
create policy general_files_read on storage.objects
  for select using (
    bucket_id = 'general-files'
    and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists general_files_write on storage.objects;
create policy general_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and public.general_task_project(public.general_safe_uuid((storage.foldername(name))[2]))
        = public.general_safe_uuid((storage.foldername(name))[1])
    and (
      (public.is_general_task_assignee(public.general_safe_uuid((storage.foldername(name))[2]))
       and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
       and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1])))
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
  );

drop policy if exists general_files_remove on storage.objects;
create policy general_files_remove on storage.objects
  for delete using (
    bucket_id = 'general-files'
    and (
      exists (select 1 from public.general_task_files f
               where f.file_path = name and f.uploaded_by = auth.uid())
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
  );

-- ---------------------------------------------------------------- realtime

-- Realtime does not apply row-level security to DELETE events, so a delete
-- from general_task_assignees would broadcast who used to hold a task to
-- every subscriber on the project, member or not. The client's poll plus the
-- general_tasks update events already cover assignment changes.
do $$ begin
  alter publication supabase_realtime drop table public.general_task_assignees;
exception when undefined_object then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['general_tasks', 'general_task_comments',
                           'general_task_files', 'general_task_logs', 'general_task_events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
