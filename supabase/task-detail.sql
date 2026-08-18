-- Collabify — task detail: files, comments, and a work log.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/task-detail.sql

begin;

do $$ begin
  alter type public.task_event_kind add value if not exists 'commented';
exception when undefined_object then null; end $$;
do $$ begin
  alter type public.task_event_kind add value if not exists 'logged';
exception when undefined_object then null; end $$;
do $$ begin
  alter type public.task_event_kind add value if not exists 'file_added';
exception when undefined_object then null; end $$;
do $$ begin
  alter type public.task_event_kind add value if not exists 'file_removed';
exception when undefined_object then null; end $$;

commit;

-- New enum values cannot be used in the transaction that adds them.
begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.task_files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.project_tasks (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_path   text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists task_files_task_idx on public.task_files (task_id, created_at);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.project_tasks (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  constraint task_comments_body_present check (length(btrim(body)) > 0)
);

create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

-- Minutes rather than hours, so totals are plain arithmetic. Evidence of effort,
-- never points: marks come only from task weight.
create table if not exists public.task_worklog (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.project_tasks (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  minutes    int not null,
  note       text not null default '',
  worked_on  date not null default current_date,
  created_at timestamptz not null default now(),
  constraint task_worklog_minutes_sane check (minutes between 1 and 1440)
);

create index if not exists task_worklog_task_idx on public.task_worklog (task_id, worked_on desc);

-- ---------------------------------------------------------------- helpers

/** Is this person on the task? Attaching and logging time are theirs alone. */
create or replace function public.is_task_assignee(p_task uuid, p_student uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_assignees
     where task_id = p_task and student_id = coalesce(p_student, auth.uid())
  );
$$;

/* ---------------------------------------------------------------- files */

/**
 * Text freezes when a task starts, but the deliverable is still being made, so
 * files stay open until it is done. An unclaimed task takes none: with nobody
 * on it, there is nobody whose work it would be.
 */
create or replace function public.guard_task_file()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;

  select status into state from public.project_tasks where id = new.task_id;
  if state = 'done' then
    raise exception 'This task is finished, so its files can no longer change'
      using errcode = 'check_violation';
  end if;

  if not public.is_task_assignee(new.task_id) then
    raise exception 'Only the people on this task can attach files to it'
      using errcode = 'check_violation';
  end if;

  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists task_files_guard on public.task_files;
create trigger task_files_guard before insert on public.task_files
  for each row execute function public.guard_task_file();

/** Removing a file follows the same window, with the professor exempt. */
create or replace function public.guard_task_file_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
begin
  if auth.uid() is null or public.is_board_professor(public.task_board(old.task_id)) then
    return old;
  end if;

  select status into state from public.project_tasks where id = old.task_id;
  if state is null then
    return old; -- the task itself is going
  end if;
  if state = 'done' then
    raise exception 'This task is finished, so its files can no longer change'
      using errcode = 'check_violation';
  end if;
  if not public.is_task_assignee(old.task_id) then
    raise exception 'Only the people on this task can remove its files'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists task_files_guard_delete on public.task_files;
create trigger task_files_guard_delete before delete on public.task_files
  for each row execute function public.guard_task_file_delete();

/* ------------------------------------------------------------- comments */

/** Anyone on the board may say something; only the author may rewrite it. */
create or replace function public.guard_task_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.is_board_member(public.task_board(new.task_id)) then
      raise exception 'Only this board can comment on its tasks';
    end if;
    new.author_id := coalesce(new.author_id, auth.uid());
    return new;
  end if;

  if old.author_id <> auth.uid() then
    raise exception 'Only the author can edit a comment';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  -- Pinned, so an edit cannot quietly move itself up the thread.
  new.task_id    := old.task_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists task_comments_guard on public.task_comments;
create trigger task_comments_guard before insert or update on public.task_comments
  for each row execute function public.guard_task_comment();

/* -------------------------------------------------------------- worklog */

create or replace function public.guard_task_worklog()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.student_id <> auth.uid() then
    raise exception 'You can only log your own time';
  end if;
  if not public.is_task_assignee(new.task_id, new.student_id) then
    raise exception 'Only the people on this task can log time against it'
      using errcode = 'check_violation';
  end if;

  select status into state from public.project_tasks where id = new.task_id;
  if state = 'todo' then
    raise exception 'Start the task before logging time on it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists task_worklog_guard on public.task_worklog;
create trigger task_worklog_guard before insert on public.task_worklog
  for each row execute function public.guard_task_worklog();

/* ---------------------------------------------------------------- trail */

-- One ordered history rather than four lists merged in the client.
create or replace function public.log_task_side_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  task uuid;
  kind public.task_event_kind;
  who  uuid;
  what text := '';
begin
  if tg_op = 'DELETE' then
    task := old.task_id;
    kind := 'file_removed';
    who  := auth.uid();
    what := old.file_name;
  elsif tg_table_name = 'task_files' then
    task := new.task_id;
    kind := 'file_added';
    who  := coalesce(auth.uid(), new.uploaded_by);
    what := new.file_name;
  elsif tg_table_name = 'task_comments' then
    task := new.task_id;
    kind := 'commented';
    who  := coalesce(auth.uid(), new.author_id);
  else
    task := new.task_id;
    kind := 'logged';
    who  := coalesce(auth.uid(), new.student_id);
    what := new.minutes || 'm';
  end if;

  insert into public.task_events (task_id, actor_id, kind, detail)
  values (task, who, kind, what);
  return coalesce(new, old);
end;
$$;

drop trigger if exists task_files_log on public.task_files;
create trigger task_files_log after insert or delete on public.task_files
  for each row execute function public.log_task_side_event();

drop trigger if exists task_comments_log on public.task_comments;
create trigger task_comments_log after insert on public.task_comments
  for each row execute function public.log_task_side_event();

drop trigger if exists task_worklog_log on public.task_worklog;
create trigger task_worklog_log after insert on public.task_worklog
  for each row execute function public.log_task_side_event();

-- ---------------------------------------------------------------- RLS

alter table public.task_files    enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_worklog  enable row level security;

drop policy if exists task_files_select on public.task_files;
create policy task_files_select on public.task_files
  for select using (public.can_see_board(public.task_board(task_id)));

drop policy if exists task_files_insert on public.task_files;
create policy task_files_insert on public.task_files
  for insert with check (public.is_board_member(public.task_board(task_id)));

drop policy if exists task_files_delete on public.task_files;
create policy task_files_delete on public.task_files
  for delete using (
    public.is_board_member(public.task_board(task_id))
    or public.is_board_professor(public.task_board(task_id))
  );

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select using (public.can_see_board(public.task_board(task_id)));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert with check (public.is_board_member(public.task_board(task_id)));

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments
  for update using (author_id = auth.uid());

-- The author tidies up after themselves; the professor can remove anything.
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
  for delete using (
    author_id = auth.uid()
    or public.is_board_professor(public.task_board(task_id))
  );

drop policy if exists task_worklog_select on public.task_worklog;
create policy task_worklog_select on public.task_worklog
  for select using (public.can_see_board(public.task_board(task_id)));

drop policy if exists task_worklog_write on public.task_worklog;
create policy task_worklog_write on public.task_worklog
  for all using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ---------------------------------------------------------------- view

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

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do update set public = false;

-- Paths start with the task id.
drop policy if exists task_files_read on storage.objects;
create policy task_files_read on storage.objects
  for select using (
    bucket_id = 'task-files'
    and public.can_see_board(public.task_board(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists task_files_write on storage.objects;
create policy task_files_write on storage.objects
  for insert with check (
    bucket_id = 'task-files'
    and public.is_task_assignee(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists task_files_remove on storage.objects;
create policy task_files_remove on storage.objects
  for delete using (
    bucket_id = 'task-files'
    and (
      public.is_task_assignee(((storage.foldername(name))[1])::uuid)
      or public.is_board_professor(public.task_board(((storage.foldername(name))[1])::uuid))
    )
  );

-- ---------------------------------------------------------------- realtime

alter table public.task_comments replica identity full;
alter table public.task_files    replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.task_files;
exception when duplicate_object then null; end $$;

commit;
