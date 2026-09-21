-- A code repository for General projects.
--
-- The GitHub-shaped half of the request: files, commits, changes, reviews and
-- history, for the projects that build software. It is deliberately not a Git
-- server — `git push` from a laptop needs a host speaking the Git wire
-- protocol, which Supabase cannot be. Everything else a school project needs
-- from one is here, driven from the browser.
--
--   * a commit is a set of file writes applied together, with a message
--   * a file's content lives on the commit that wrote it, so history is whole
--   * whoever holds `edit_files` commits straight to the repository
--   * everybody else opens a change, which is reviewed, commented on, and
--     merged as a commit or closed
--
-- A commit is never edited and never deleted. That is the point of a history.
--
-- Depends on supabase/general.sql.
--
-- Idempotent. Safe to re-run.

begin;

do $$ begin
  create type public.general_change_status as enum
    ('open', 'applied', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

commit;

begin;

create table if not exists public.general_repos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  name        text not null default 'Repository',
  description text not null default '',
  -- Denormalised so a header does not need to count commits.
  commit_count int not null default 0,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_repos_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint general_repos_description_len check (char_length(description) <= 4000),
  constraint general_repos_count check (commit_count >= 0),
  constraint general_repos_id_project unique (id, project_id),
  -- One per project for now. Splitting a school project across repositories has
  -- never been the problem; finding the one repository always is.
  constraint general_repos_one_per_project unique (project_id)
);

create table if not exists public.general_commits (
  id         uuid primary key default gen_random_uuid(),
  repo_id    uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  seq        int not null,
  message    text not null,
  author_id  uuid references public.profiles (id) on delete set null,
  /** Set when this commit came from a merged change. */
  change_id  uuid,
  created_at timestamptz not null default now(),
  constraint general_commits_message_len check (char_length(btrim(message)) between 1 and 2000),
  constraint general_commits_seq check (seq >= 1),
  constraint general_commits_unique unique (repo_id, seq),
  constraint general_commits_id_project unique (id, project_id),
  foreign key (repo_id, project_id)
    references public.general_repos (id, project_id) on delete cascade
);

create index if not exists general_commits_repo_idx on public.general_commits (repo_id, seq desc);
create index if not exists general_commits_author_idx on public.general_commits (author_id);

do $$ begin
  create type public.general_file_action as enum ('added', 'changed', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_file_kind as enum ('text', 'rich', 'sheet', 'binary');
exception when duplicate_object then null; end $$;

/*
 * One row per file per commit. The newest row for a path is what the file says
 * now; a row with action 'removed' means the path is gone as of that commit.
 * Reading the tree is therefore a `distinct on (path)` over the commits so far,
 * and history needs no separate store.
 */
create table if not exists public.general_blobs (
  id         uuid primary key default gen_random_uuid(),
  commit_id  uuid not null,
  repo_id    uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  seq        int not null,
  path       text not null,
  action     public.general_file_action not null,
  kind       public.general_file_kind not null default 'text',
  content    text not null default '',
  storage_path text,
  created_at timestamptz not null default now(),
  constraint general_blobs_path_len check (char_length(btrim(path)) between 1 and 400),
  -- No absolute paths, no climbing out, no backslashes, no trailing slash.
  constraint general_blobs_path_shape check (
    path !~ '^/' and path !~ '\\' and path !~ '(^|/)\.\.(/|$)' and path !~ '/$'
  ),
  constraint general_blobs_content_len check (char_length(content) <= 400000),
  constraint general_blobs_storage_shape check (
    (kind = 'binary' and storage_path is not null and content = '')
    or (kind <> 'binary' and storage_path is null)
  ),
  constraint general_blobs_unique unique (commit_id, path),
  foreign key (commit_id, project_id)
    references public.general_commits (id, project_id) on delete cascade
);

create index if not exists general_blobs_tree_idx
  on public.general_blobs (repo_id, path, seq desc);
create index if not exists general_blobs_commit_idx on public.general_blobs (commit_id);

alter table public.general_blobs
  add column if not exists kind public.general_file_kind not null default 'text';
alter table public.general_blobs
  add column if not exists storage_path text;

create table if not exists public.general_repo_changes (
  id           uuid primary key default gen_random_uuid(),
  repo_id      uuid not null,
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  title        text not null,
  body         text not null default '',
  -- The commit the author worked from, 0 for an empty repository.
  base_seq     int not null,
  /** [{path, action, content}] — the same shape a commit takes. */
  files        jsonb not null default '[]'::jsonb,
  status       public.general_change_status not null default 'open',
  reviewer_id  uuid references public.profiles (id) on delete set null,
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  decided_note text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint general_repo_changes_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint general_repo_changes_body_len check (char_length(body) <= 20000),
  constraint general_repo_changes_note_len check (char_length(decided_note) <= 2000),
  constraint general_repo_changes_files_array check (jsonb_typeof(files) = 'array'),
  constraint general_repo_changes_files_count check (jsonb_array_length(files) <= 100),
  constraint general_repo_changes_base check (base_seq >= 0),
  constraint general_repo_changes_id_project unique (id, project_id),
  foreign key (repo_id, project_id)
    references public.general_repos (id, project_id) on delete cascade
);

create index if not exists general_repo_changes_repo_idx
  on public.general_repo_changes (repo_id, created_at desc);
create index if not exists general_repo_changes_author_idx
  on public.general_repo_changes (author_id);
create index if not exists general_repo_changes_decided_idx
  on public.general_repo_changes (decided_by);

alter table public.general_repo_changes
  add column if not exists reviewer_id uuid references public.profiles (id) on delete set null;
create index if not exists general_repo_changes_reviewer_idx
  on public.general_repo_changes (reviewer_id);

create table if not exists public.general_repo_comments (
  id         uuid primary key default gen_random_uuid(),
  change_id  uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  /** Set when the comment is about one file in the change. */
  path       text,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint general_repo_comments_body_len check (char_length(btrim(body)) between 1 and 5000),
  constraint general_repo_comments_path_len check (path is null or char_length(path) <= 400),
  foreign key (change_id, project_id)
    references public.general_repo_changes (id, project_id) on delete cascade
);

create index if not exists general_repo_comments_change_idx
  on public.general_repo_comments (change_id, created_at);
create index if not exists general_repo_comments_author_idx
  on public.general_repo_comments (author_id);

drop trigger if exists general_repos_touch on public.general_repos;
create trigger general_repos_touch before update on public.general_repos
  for each row execute function public.touch_updated_at();

drop trigger if exists general_repo_changes_touch on public.general_repo_changes;
create trigger general_repo_changes_touch before update on public.general_repo_changes
  for each row execute function public.touch_updated_at();

commit;

begin;

-- ---------------------------------------------------------------- guards

/* A commit and its files are the history. Neither is anybody's to rewrite. */
create or replace function public.guard_general_commit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'A commit cannot be changed or removed once it is made'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists general_commits_frozen on public.general_commits;
create trigger general_commits_frozen before update or delete on public.general_commits
  for each row execute function public.guard_general_commit();

drop trigger if exists general_blobs_frozen on public.general_blobs;
create trigger general_blobs_frozen before update or delete on public.general_blobs
  for each row execute function public.guard_general_commit();

create or replace function public.guard_general_repo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id then
      raise exception 'A repository cannot move project' using errcode = 'insufficient_privilege';
    end if;
    if new.commit_count < old.commit_count then
      raise exception 'A repository cannot lose commits' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists general_repos_guard on public.general_repos;
create trigger general_repos_guard before insert or update on public.general_repos
  for each row execute function public.guard_general_repo();

create or replace function public.guard_general_repo_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid() then
      raise exception 'A change is opened by whoever wrote it' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'open' or new.decided_by is not null or new.decided_at is not null then
      raise exception 'A change starts open and undecided' using errcode = 'insufficient_privilege';
    end if;
    if new.reviewer_id is not null then
      if new.reviewer_id = new.author_id then
        raise exception 'Choose somebody else to review your change'
          using errcode = 'insufficient_privilege';
      end if;
      if not exists (
        select 1 from public.general_members m
        join public.profiles pr on pr.id = m.user_id
         where m.project_id = new.project_id and m.user_id = new.reviewer_id
           and pr.status <> 'rejected'
      ) then
        raise exception 'The reviewer must be on this project'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id or new.repo_id <> old.repo_id then
      raise exception 'A change cannot move' using errcode = 'insufficient_privilege';
    end if;
    if new.author_id is distinct from old.author_id or new.created_at <> old.created_at then
      raise exception 'A change keeps who opened it' using errcode = 'insufficient_privilege';
    end if;
    if new.reviewer_id is distinct from old.reviewer_id
       and coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
      raise exception 'A change keeps its reviewer' using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'open' then
      raise exception 'That change was already answered' using errcode = 'insufficient_privilege';
    end if;
    -- The author may keep editing their own open change; deciding one is the
    -- RPC's, which sets collabify.general_repo_op.
    if new.status <> old.status then
      if new.status = 'withdrawn' then
        if old.author_id is distinct from auth.uid() then
          raise exception 'Only whoever opened a change withdraws it'
            using errcode = 'insufficient_privilege';
        end if;
      elsif coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
        raise exception 'Use the review buttons to answer a change'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.author_id is distinct from auth.uid()
          and coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
      raise exception 'Only whoever opened a change edits it' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists general_repo_changes_guard on public.general_repo_changes;
create trigger general_repo_changes_guard before insert or update on public.general_repo_changes
  for each row execute function public.guard_general_repo_change();

create or replace function public.guard_general_repo_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(new.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.author_id is distinct from auth.uid() then
    raise exception 'A comment is posted by whoever wrote it' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_repo_comments_guard on public.general_repo_comments;
create trigger general_repo_comments_guard before insert on public.general_repo_comments
  for each row execute function public.guard_general_repo_comment();

commit;

begin;

-- ---------------------------------------------------------------- policies

alter table public.general_repos          enable row level security;
alter table public.general_commits        enable row level security;
alter table public.general_blobs          enable row level security;
alter table public.general_repo_changes   enable row level security;
alter table public.general_repo_comments  enable row level security;

drop policy if exists general_repos_select on public.general_repos;
create policy general_repos_select on public.general_repos
  for select using (public.is_general_member(project_id));

drop policy if exists general_repos_write on public.general_repos;
create policy general_repos_write on public.general_repos
  for all using (public.general_can(project_id, 'edit_files'))
  with check (public.general_can(project_id, 'edit_files'));

drop policy if exists general_commits_select on public.general_commits;
create policy general_commits_select on public.general_commits
  for select using (public.is_general_member(project_id));

drop policy if exists general_commits_insert on public.general_commits;
create policy general_commits_insert on public.general_commits
  for insert with check (public.general_can(project_id, 'edit_files'));

drop policy if exists general_blobs_select on public.general_blobs;
create policy general_blobs_select on public.general_blobs
  for select using (public.is_general_member(project_id));

drop policy if exists general_blobs_insert on public.general_blobs;
create policy general_blobs_insert on public.general_blobs
  for insert with check (public.general_can(project_id, 'edit_files'));

drop policy if exists general_repo_changes_select on public.general_repo_changes;
create policy general_repo_changes_select on public.general_repo_changes
  for select using (public.is_general_member(project_id));

drop policy if exists general_repo_changes_insert on public.general_repo_changes;
create policy general_repo_changes_insert on public.general_repo_changes
  for insert with check (
    public.is_general_member(project_id)
    and public.general_viewer_active()
    and not public.general_is_archived(project_id)
  );

drop policy if exists general_repo_changes_update on public.general_repo_changes;
create policy general_repo_changes_update on public.general_repo_changes
  for update using (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  )
  with check (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

drop policy if exists general_repo_comments_select on public.general_repo_comments;
create policy general_repo_comments_select on public.general_repo_comments
  for select using (public.is_general_member(project_id));

drop policy if exists general_repo_comments_insert on public.general_repo_comments;
create policy general_repo_comments_insert on public.general_repo_comments
  for insert with check (
    public.is_general_member(project_id) and public.general_viewer_active()
  );

drop policy if exists general_repo_comments_delete on public.general_repo_comments;
create policy general_repo_comments_delete on public.general_repo_comments
  for delete using (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

revoke all on public.general_repos, public.general_commits, public.general_blobs,
              public.general_repo_changes, public.general_repo_comments from public, anon;
grant select, insert, update, delete on public.general_repos to authenticated;
grant select, insert on public.general_commits to authenticated;
grant select, insert on public.general_blobs to authenticated;
grant select, insert, update on public.general_repo_changes to authenticated;
grant select, insert, delete on public.general_repo_comments to authenticated;

commit;

begin;

-- ---------------------------------------------------------------- rpcs

create or replace function public.create_general_repo(
  p_project     uuid,
  p_name        text default 'Repository',
  p_description text default ''
) returns public.general_repos
language plpgsql security definer set search_path = public as $$
declare
  r public.general_repos%rowtype;
begin
  if not public.general_viewer_active() or not public.general_can(p_project, 'edit_files') then
    raise exception 'You do not have permission to start a repository. Ask an Owner for it.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.general_repos (project_id, name, description, created_by)
  values (p_project, btrim(coalesce(nullif(btrim(p_name), ''), 'Repository')),
          coalesce(p_description, ''), auth.uid())
  returning * into r;

  return r;
end;
$$;

/*
 * Applies a set of file writes as one commit.
 *
 * `p_files` is [{path, action, content}]. A caller says which commit they were
 * working from, and a newer one is refused — the same rule the documents follow,
 * for the same reason: nobody's work disappears without being told.
 */
create or replace function public.commit_general_files(
  p_repo     uuid,
  p_message  text,
  p_base_seq int,
  p_files    jsonb,
  p_author   uuid default null,
  p_change   uuid default null
) returns public.general_commits
language plpgsql security definer set search_path = public as $$
declare
  r       public.general_repos%rowtype;
  c       public.general_commits%rowtype;
  item    jsonb;
  seen    text[] := array[]::text[];
  v_path  text;
  v_act   text;
  v_kind  text;
  v_store text;
  live    int;
begin
  select * into r from public.general_repos where id = p_repo for update;
  if not found then
    raise exception 'That repository is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active()
     or not (
       public.general_can(r.project_id, 'edit_files')
       or (p_change is not null
           and coalesce(current_setting('collabify.general_repo_op', true), 'off') = 'on')
     ) then
    raise exception 'You do not have permission to commit. Open a change instead.'
      using errcode = 'insufficient_privilege';
  end if;

  if r.commit_count <> p_base_seq then
    raise exception 'Somebody committed while you were working. The repository is on commit %; reopen it and put your work back.', r.commit_count
      using errcode = 'serialization_failure';
  end if;

  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'A commit needs at least one file' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_files) > 100 then
    raise exception 'A commit can carry up to 100 files' using errcode = 'check_violation';
  end if;

  insert into public.general_commits (repo_id, project_id, seq, message, author_id, change_id)
  values (r.id, r.project_id, r.commit_count + 1, btrim(p_message),
          coalesce(p_author, auth.uid()), p_change)
  returning * into c;

  for item in select value from jsonb_array_elements(p_files) loop
    v_path  := btrim(item ->> 'path');
    v_act   := item ->> 'action';
    v_kind  := coalesce(item ->> 'kind', 'text');
    v_store := nullif(btrim(coalesce(item ->> 'storage_path', '')), '');

    if v_path is null or v_path = '' then
      raise exception 'A file needs a path' using errcode = 'invalid_parameter_value';
    end if;
    if v_act not in ('added', 'changed', 'removed') then
      raise exception 'A file is added, changed or removed' using errcode = 'invalid_parameter_value';
    end if;
    if v_kind not in ('text', 'rich', 'sheet', 'binary') then
      raise exception 'A file is text, rich, sheet or binary' using errcode = 'invalid_parameter_value';
    end if;
    if v_path = any (seen) then
      raise exception 'The same file appears twice in one commit: %', v_path
        using errcode = 'invalid_parameter_value';
    end if;
    seen := seen || v_path;

    if v_kind = 'binary' then
      if v_store is null then
        raise exception 'A binary file needs its uploaded object' using errcode = 'invalid_parameter_value';
      end if;
      if v_store !~ ('^' || r.project_id::text || '/files/') then
        raise exception 'That file was not uploaded to this project' using errcode = 'insufficient_privilege';
      end if;
    elsif v_store is not null then
      raise exception 'Only a binary file has an uploaded object' using errcode = 'invalid_parameter_value';
    end if;

    -- What the repository says about this path right now, so a commit cannot
    -- claim to add a file that exists or remove one that does not.
    select count(*) into live
      from (
        select distinct on (b.path) b.action
          from public.general_blobs b
         where b.repo_id = r.id and b.path = v_path and b.seq < c.seq
         order by b.path, b.seq desc
      ) t
     where t.action <> 'removed';

    if v_act = 'added' and live > 0 then
      raise exception 'That file already exists: %', v_path using errcode = 'unique_violation';
    end if;
    if v_act <> 'added' and live = 0 then
      raise exception 'That file is not in the repository: %', v_path using errcode = 'no_data_found';
    end if;

    insert into public.general_blobs
      (commit_id, repo_id, project_id, seq, path, action, kind, content, storage_path)
    values (c.id, r.id, r.project_id, c.seq, v_path, v_act::public.general_file_action,
            v_kind::public.general_file_kind,
            case when v_act = 'removed' or v_kind = 'binary' then ''
                 else coalesce(item ->> 'content', '') end,
            case when v_kind = 'binary' then v_store end);
  end loop;

  update public.general_repos set commit_count = c.seq where id = r.id;

  return c;
end;
$$;

/** Merging a change is a commit like any other, credited to its author. */
create or replace function public.answer_general_repo_change(
  p_change uuid,
  p_merge  boolean,
  p_note   text default ''
) returns public.general_repo_changes
language plpgsql security definer set search_path = public as $$
declare
  ch public.general_repo_changes%rowtype;
  r  public.general_repos%rowtype;
begin
  select * into ch from public.general_repo_changes where id = p_change for update;
  if not found then
    raise exception 'That change is gone' using errcode = 'no_data_found';
  end if;

  if ch.author_id = auth.uid() then
    raise exception 'You cannot answer your own change'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.general_viewer_active()
     or (
       (ch.reviewer_id is not null and ch.reviewer_id <> auth.uid())
       or (ch.reviewer_id is null and not public.general_can(ch.project_id, 'edit_files'))
     ) then
    raise exception 'You are not the reviewer for this change'
      using errcode = 'insufficient_privilege';
  end if;

  if ch.status <> 'open' then
    raise exception 'That change was already answered' using errcode = 'invalid_parameter_value';
  end if;

  if p_merge then
    select * into r from public.general_repos where id = ch.repo_id;
    if r.commit_count <> ch.base_seq then
      raise exception 'This change was written against commit % and the repository is now on commit %. Ask its author to bring it up to date.', ch.base_seq, r.commit_count
        using errcode = 'serialization_failure';
    end if;

    perform set_config('collabify.general_repo_op', 'on', true);
    perform public.commit_general_files(
      ch.repo_id,
      left(coalesce(nullif(btrim(ch.title), ''), 'Merged a change'), 2000),
      ch.base_seq,
      ch.files,
      ch.author_id,
      ch.id);
    perform set_config('collabify.general_repo_op', 'off', true);
  end if;

  perform set_config('collabify.general_repo_op', 'on', true);
  update public.general_repo_changes
     set status = case when p_merge then 'applied' else 'declined' end::public.general_change_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decided_note = left(coalesce(p_note, ''), 2000)
   where id = ch.id
  returning * into ch;
  perform set_config('collabify.general_repo_op', 'off', true);

  return ch;
end;
$$;

revoke all on function public.create_general_repo(uuid, text, text) from public, anon;
revoke all on function public.commit_general_files(uuid, text, int, jsonb, uuid, uuid) from public, anon;
revoke all on function public.answer_general_repo_change(uuid, boolean, text) from public, anon;
grant execute on function public.create_general_repo(uuid, text, text) to authenticated;
grant execute on function public.commit_general_files(uuid, text, int, jsonb, uuid, uuid) to authenticated;
grant execute on function public.answer_general_repo_change(uuid, boolean, text) to authenticated;

revoke all on function public.guard_general_repo() from public, anon;
revoke all on function public.guard_general_commit() from public, anon;
revoke all on function public.guard_general_repo_change() from public, anon;
revoke all on function public.guard_general_repo_comment() from public, anon;

commit;

begin;

-- ---------------------------------------------------------------- views

/*
 * The repository as it stands: the newest row for every path, minus the paths
 * whose newest row is a removal. This is the working tree.
 */
drop view if exists public.general_repo_overview;
drop view if exists public.general_repo_tree;
create view public.general_repo_tree
with (security_invoker = true) as
select b.id,
       b.repo_id,
       b.project_id,
       b.commit_id,
       b.seq,
       b.path,
       b.kind,
       b.content,
       b.storage_path,
       length(b.content) as size,
       b.created_at
  from (
    select distinct on (x.repo_id, x.path) x.*
      from public.general_blobs x
     order by x.repo_id, x.path, x.seq desc
  ) b
 where b.action <> 'removed';

grant select on public.general_repo_tree to authenticated;

drop view if exists public.general_repo_overview;
create view public.general_repo_overview
with (security_invoker = true) as
select r.id,
       r.project_id,
       r.name,
       r.description,
       r.commit_count,
       r.created_by,
       r.created_at,
       r.updated_at,
       (select count(*) from public.general_repo_tree t where t.repo_id = r.id)::int as file_count,
       (select count(*) from public.general_repo_changes c
         where c.repo_id = r.id and c.status = 'open')::int as open_change_count,
       c.author_id as last_author,
       c.message as last_message,
       c.created_at as last_commit_at
  from public.general_repos r
  left join lateral (
    select x.author_id, x.message, x.created_at
      from public.general_commits x
     where x.repo_id = r.id
     order by x.seq desc
     limit 1
  ) c on true;

grant select on public.general_repo_overview to authenticated;

commit;

begin;

do $$
declare
  t text;
begin
  foreach t in array array['general_repos', 'general_commits', 'general_repo_changes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
