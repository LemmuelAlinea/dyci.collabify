-- A working copy of a project's files, one per person.
--
-- This is the part of the request the rest hangs off: a main folder everything
-- is committed to, and somewhere separate to change files until the group
-- approves them.
--
--   Main      general_blobs, reached through general_repo_tree. Only a commit
--             puts anything here.
--   My draft  general_draft_files. Yours alone — nobody else reads it, not even
--             an Owner. Change as many files as you like, for as long as you
--             like.
--   Review    submitting a draft turns the whole set into one general_repo_changes
--             row, which is read, commented on, and merged or closed as before.
--
-- A draft remembers the commit it was started from. When Main moves on, the
-- draft says which of its files were touched underneath it rather than quietly
-- overwriting somebody's work at merge time.
--
-- Everybody drafts, including people who can commit — the difference is that
-- they can also write to Main directly.
--
-- Depends on supabase/general-repo.sql and supabase/general-files.sql.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.general_drafts (
  id         uuid primary key default gen_random_uuid(),
  repo_id    uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- The commit this working copy was started from.
  base_seq   int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint general_drafts_base check (base_seq >= 0),
  constraint general_drafts_one_each unique (repo_id, user_id),
  constraint general_drafts_id_project unique (id, project_id),
  foreign key (repo_id, project_id)
    references public.general_repos (id, project_id) on delete cascade
);

create index if not exists general_drafts_user_idx on public.general_drafts (user_id);

create table if not exists public.general_draft_files (
  id           uuid primary key default gen_random_uuid(),
  draft_id     uuid not null,
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  path         text not null,
  action       public.general_file_action not null,
  kind         public.general_file_kind not null default 'text',
  content      text not null default '',
  storage_path text,
  updated_at   timestamptz not null default now(),
  constraint general_draft_files_path_len check (char_length(btrim(path)) between 1 and 400),
  -- The same path rules Main enforces, so nothing can pass review that could
  -- not have been committed directly.
  constraint general_draft_files_path_shape check (
    path !~ '^/' and path !~ '\\' and path !~ '(^|/)\.\.(/|$)' and path !~ '/$'
  ),
  constraint general_draft_files_content_len check (char_length(content) <= 400000),
  constraint general_draft_files_storage_shape check (
    (kind = 'binary' and storage_path is not null and content = '')
    or (kind <> 'binary' and storage_path is null)
  ),
  constraint general_draft_files_unique unique (draft_id, path),
  foreign key (draft_id, project_id)
    references public.general_drafts (id, project_id) on delete cascade
);

create index if not exists general_draft_files_draft_idx
  on public.general_draft_files (draft_id, path);

drop trigger if exists general_drafts_touch on public.general_drafts;
create trigger general_drafts_touch before update on public.general_drafts
  for each row execute function public.touch_updated_at();

commit;

begin;

-- ---------------------------------------------------------------- policies

alter table public.general_drafts      enable row level security;
alter table public.general_draft_files enable row level security;

/*
 * Yours and nobody else's.
 *
 * A working copy is half-finished by definition. Letting an Owner read one
 * would make people draft somewhere else, which defeats the whole feature — so
 * the only way anybody sees your work is when you submit it.
 */
drop policy if exists general_drafts_own on public.general_drafts;
create policy general_drafts_own on public.general_drafts
  for all using (user_id = auth.uid() and public.is_general_member(project_id))
  with check (user_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_draft_files_own on public.general_draft_files;
create policy general_draft_files_own on public.general_draft_files
  for all using (
    exists (select 1 from public.general_drafts d
             where d.id = draft_id and d.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.general_drafts d
             where d.id = draft_id and d.user_id = auth.uid())
  );

revoke all on public.general_drafts, public.general_draft_files from public, anon;
grant select, insert, update, delete on public.general_drafts to authenticated;
grant select, insert, update, delete on public.general_draft_files to authenticated;

commit;

begin;

-- ---------------------------------------------------------------- guards

create or replace function public.guard_general_draft()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to work on files'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' and new.user_id is distinct from auth.uid() then
    raise exception 'A draft belongs to whoever is working in it'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id
                           or new.repo_id <> old.repo_id
                           or new.project_id <> old.project_id) then
    raise exception 'A draft cannot change hands' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_drafts_guard on public.general_drafts;
create trigger general_drafts_guard before insert or update on public.general_drafts
  for each row execute function public.guard_general_draft();

create or replace function public.guard_general_draft_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to work on files'
      using errcode = 'insufficient_privilege';
  end if;
  -- An uploaded object must sit under this project's own folder, the same rule
  -- a commit follows.
  if tg_op <> 'DELETE' and new.kind = 'binary'
     and new.storage_path !~ ('^' || new.project_id::text || '/files/') then
    raise exception 'That file was not uploaded to this project'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists general_draft_files_guard on public.general_draft_files;
create trigger general_draft_files_guard
  before insert or update or delete on public.general_draft_files
  for each row execute function public.guard_general_draft_file();

revoke all on function public.guard_general_draft() from public, anon;
revoke all on function public.guard_general_draft_file() from public, anon;

commit;

begin;

-- ---------------------------------------------------------------- rpcs

/** The caller's working copy, started at the newest commit if there is none. */
create or replace function public.my_general_draft(p_repo uuid)
returns public.general_drafts
language plpgsql security definer set search_path = public as $$
declare
  r public.general_repos%rowtype;
  d public.general_drafts%rowtype;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'That repository is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;

  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if found then
    return d;
  end if;

  insert into public.general_drafts (repo_id, project_id, user_id, base_seq)
  values (r.id, r.project_id, auth.uid(), r.commit_count)
  returning * into d;

  return d;
end;
$$;

/**
 * Puts one file into the caller's draft, replacing whatever was there for that
 * path. `p_action` says what it would do to Main, so removing a file is a row
 * in the draft too rather than the absence of one.
 */
create or replace function public.save_general_draft_file(
  p_repo    uuid,
  p_path    text,
  p_action  text,
  p_kind    text default 'text',
  p_content text default '',
  p_storage text default null
) returns public.general_draft_files
language plpgsql security definer set search_path = public as $$
declare
  d      public.general_drafts%rowtype;
  f      public.general_draft_files%rowtype;
  v_path text := btrim(p_path);
begin
  d := public.my_general_draft(p_repo);

  if p_action not in ('added', 'changed', 'removed') then
    raise exception 'A file is added, changed or removed' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind not in ('text', 'rich', 'sheet', 'binary') then
    raise exception 'A file is text, rich, sheet or binary' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.general_draft_files
    (draft_id, project_id, path, action, kind, content, storage_path)
  values (d.id, d.project_id, v_path, p_action::public.general_file_action,
          p_kind::public.general_file_kind,
          case when p_kind = 'binary' then '' else coalesce(p_content, '') end,
          case when p_kind = 'binary' then p_storage end)
  on conflict (draft_id, path) do update
     set action = excluded.action,
         kind = excluded.kind,
         content = excluded.content,
         storage_path = excluded.storage_path,
         updated_at = now()
  returning * into f;

  update public.general_drafts set updated_at = now() where id = d.id;

  return f;
end;
$$;

create or replace function public.discard_general_draft_file(p_repo uuid, p_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    return;
  end if;
  delete from public.general_draft_files where draft_id = d.id and path = btrim(p_path);
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

create or replace function public.discard_general_draft(p_repo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  r public.general_repos%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    return;
  end if;
  select * into r from public.general_repos where id = p_repo;
  delete from public.general_draft_files where draft_id = d.id;
  update public.general_drafts set base_seq = r.commit_count, updated_at = now()
   where id = d.id;
end;
$$;

/**
 * Which of the draft's files were touched in Main since the draft started.
 *
 * Answered rather than acted on: a person who has rewritten a chapter should be
 * told what moved under them and decide, not have their work rebased silently.
 */
create or replace function public.general_draft_conflicts(p_repo uuid)
returns table (path text, their_seq int)
language sql security definer set search_path = public as $$
  select f.path, max(b.seq)
    from public.general_drafts d
    join public.general_draft_files f on f.draft_id = d.id
    join public.general_blobs b on b.repo_id = d.repo_id and b.path = f.path
   where d.repo_id = p_repo
     and d.user_id = auth.uid()
     and b.seq > d.base_seq
   group by f.path;
$$;

/** Moves the draft onto the newest commit. Its files are left exactly as they are. */
create or replace function public.sync_general_draft(p_repo uuid)
returns public.general_drafts
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  r public.general_repos%rowtype;
begin
  d := public.my_general_draft(p_repo);
  select * into r from public.general_repos where id = p_repo;
  update public.general_drafts set base_seq = r.commit_count, updated_at = now()
   where id = d.id
  returning * into d;
  return d;
end;
$$;

/**
 * Hands the whole draft over as one change for review, and empties it.
 *
 * One change per submission rather than one per file: a chapter rewrite that
 * touches four files is one decision, and splitting it into four would make a
 * reviewer approve half a thought.
 */
create or replace function public.submit_general_draft(
  p_repo  uuid,
  p_title text,
  p_body  text default ''
) returns public.general_repo_changes
language plpgsql security definer set search_path = public as $$
declare
  d     public.general_drafts%rowtype;
  r     public.general_repos%rowtype;
  ch    public.general_repo_changes%rowtype;
  items jsonb;
  n     int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into n from public.general_draft_files where draft_id = d.id;
  if n = 0 then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;
  if n > 100 then
    raise exception 'A change can carry up to 100 files. Submit some of them first.'
      using errcode = 'check_violation';
  end if;

  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select jsonb_agg(jsonb_build_object(
           'path', f.path,
           'action', f.action,
           'kind', f.kind,
           'content', f.content,
           'storage_path', f.storage_path) order by f.path)
    into items
    from public.general_draft_files f
   where f.draft_id = d.id;

  insert into public.general_repo_changes
    (repo_id, project_id, author_id, title, body, base_seq, files)
  values (r.id, r.project_id, auth.uid(), btrim(p_title), coalesce(p_body, ''),
          d.base_seq, items)
  returning * into ch;

  delete from public.general_draft_files where draft_id = d.id;
  update public.general_drafts set updated_at = now() where id = d.id;

  return ch;
end;
$$;

revoke all on function public.my_general_draft(uuid) from public, anon;
revoke all on function public.save_general_draft_file(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.discard_general_draft_file(uuid, text) from public, anon;
revoke all on function public.discard_general_draft(uuid) from public, anon;
revoke all on function public.general_draft_conflicts(uuid) from public, anon;
revoke all on function public.sync_general_draft(uuid) from public, anon;
revoke all on function public.submit_general_draft(uuid, text, text) from public, anon;

grant execute on function public.my_general_draft(uuid) to authenticated;
grant execute on function public.save_general_draft_file(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.discard_general_draft_file(uuid, text) to authenticated;
grant execute on function public.discard_general_draft(uuid) to authenticated;
grant execute on function public.general_draft_conflicts(uuid) to authenticated;
grant execute on function public.sync_general_draft(uuid) to authenticated;
grant execute on function public.submit_general_draft(uuid, text, text) to authenticated;

commit;
