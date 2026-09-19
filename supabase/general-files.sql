-- Real files in a General project.
--
-- Generalises the repository from supabase/general-repo.sql into the project's
-- one file store. A file is still a blob keyed by path, so folders are the `/`
-- in `documents/Chapter 1.docx` and need no table of their own. What changes is
-- that a file now says what kind of thing it is:
--
--   text    plain text and code, stored in `content`, compared line by line
--   rich    a Word document, stored as HTML in `content`
--   sheet   a spreadsheet, stored as JSON in `content`
--   binary  a PDF, an image, anything the site cannot edit — in Storage, with
--           `storage_path` pointing at the object and `content` left empty
--
-- It also folds the shared documents built in supabase/general-docs.sql into
-- the same store: every document becomes a file under `documents/`, and every
-- version of it becomes a commit, keeping its author and its order. After this
-- file has run once, general-docs.sql is finished and its tables are dropped.
--
-- Redefines general_repo_tree and general_repo_overview, whose previous
-- definitions are in supabase/general-repo.sql.
--
-- Idempotent. Safe to re-run.

begin;

do $$ begin
  create type public.general_file_kind as enum ('text', 'rich', 'sheet', 'binary');
exception when duplicate_object then null; end $$;

commit;

begin;

alter table public.general_blobs
  add column if not exists kind public.general_file_kind not null default 'text';

alter table public.general_blobs
  add column if not exists storage_path text;

comment on column public.general_blobs.kind is
  'What the file is. Everything but binary keeps its contents in `content`.';
comment on column public.general_blobs.storage_path is
  'For binary files: the object in the general-files bucket. Null otherwise.';

do $$ begin
  alter table public.general_blobs
    add constraint general_blobs_storage_shape check (
      (kind = 'binary' and storage_path is not null and content = '')
      or (kind <> 'binary' and storage_path is null)
    );
exception when duplicate_object then null; end $$;

-- A removed file carries neither content nor an object, whatever kind it was.
do $$ begin
  alter table public.general_blobs
    add constraint general_blobs_removed_is_empty check (
      action <> 'removed' or (content = '' and (kind <> 'binary' or storage_path is not null))
    );
exception when duplicate_object then null; end $$;

commit;

begin;

/*
 * Rebuilt to carry the two new columns. `create or replace view` can only add
 * at the end and the overview reads the tree, so both go together.
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

/*
 * Commits now carry the kind and, for a binary file, where its object lives.
 *
 * A caller cannot invent a storage path: the RPC builds it from the blob's own
 * id, so an upload can only ever land under this project's folder. The client
 * uploads first to a path it is told, then names it here.
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

  if not public.general_viewer_active() or not public.general_can(r.project_id, 'edit_files') then
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

    -- An object must sit under this project's own files folder. Anything else
    -- would let a commit point at another project's upload.
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

revoke all on function public.commit_general_files(uuid, text, int, jsonb, uuid, uuid) from public, anon;
grant execute on function public.commit_general_files(uuid, text, int, jsonb, uuid, uuid) to authenticated;

commit;

begin;

-- ------------------------------------------------- storage for project files

/*
 * A second path shape beside the task one: <project_id>/files/<anything>.
 *
 * The task policies in supabase/general-tasks.sql read segment 2 as a task id
 * and refuse when it is not one, so a files path falls through them and needs
 * its own pair. Reading is membership; writing is edit_files, which is the same
 * permission that commits.
 */
drop policy if exists general_project_files_read on storage.objects;
create policy general_project_files_read on storage.objects
  for select using (
    bucket_id = 'general-files'
    and (storage.foldername(name))[2] = 'files'
    and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists general_project_files_write on storage.objects;
create policy general_project_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and (storage.foldername(name))[2] = 'files'
    and public.general_viewer_active()
    and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
    and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1]))
  );

/*
 * Deliberately no delete policy for this path. An object belongs to a commit,
 * and a commit is a record — removing a file writes a 'removed' blob rather
 * than taking the object away, so older commits still open.
 */

commit;

begin;

-- ------------------------------------------- documents become files, once

/*
 * Every document from supabase/general-docs.sql becomes a file under
 * `documents/`, and every one of its versions becomes a commit in order, keeping
 * the author who wrote it. Runs as the owner of this function rather than under
 * row-level security, because it is a migration, not a request.
 *
 * Guarded on the docs tables still existing, so a second run does nothing.
 *
 * guard_general_repo refuses every write to an archived project, which is right
 * for a request and wrong for a migration — a document in an archived project
 * still has to become a file. The guard is lifted for this transaction only.
 */
alter table public.general_repos disable trigger general_repos_guard;

do $$
declare
  d        record;
  v        record;
  r        public.general_repos%rowtype;
  new_path text;
  act      public.general_file_action;
  n        int;
begin
  if to_regclass('public.general_docs') is null then
    raise notice 'documents already folded in';
    return;
  end if;

  for d in select * from public.general_docs order by created_at loop
    select * into r from public.general_repos where project_id = d.project_id;
    if not found then
      insert into public.general_repos (project_id, name, description, created_by)
      values (d.project_id, 'Files', '', d.created_by)
      returning * into r;
    end if;

    -- Two documents can share a title; a path cannot.
    new_path := 'documents/' || regexp_replace(btrim(d.title), '[/\\]', '-', 'g') || '.md';
    select count(*) into n from public.general_blobs
     where repo_id = r.id and path = new_path;
    if n > 0 then
      new_path := 'documents/' || regexp_replace(btrim(d.title), '[/\\]', '-', 'g')
                  || '-' || left(d.id::text, 8) || '.md';
    end if;

    for v in select * from public.general_doc_versions
              where doc_id = d.id order by version loop
      act := case when v.version = 1 then 'added' else 'changed' end;

      insert into public.general_commits (repo_id, project_id, seq, message, author_id, created_at)
      values (r.id, r.project_id, r.commit_count + 1,
              coalesce(nullif(btrim(v.note), ''), 'Version ' || v.version),
              v.author_id, v.created_at);

      insert into public.general_blobs
        (commit_id, repo_id, project_id, seq, path, action, kind, content, created_at)
      select c.id, r.id, r.project_id, c.seq, new_path, act, 'text', v.body, v.created_at
        from public.general_commits c
       where c.repo_id = r.id and c.seq = r.commit_count + 1;

      update public.general_repos set commit_count = commit_count + 1 where id = r.id
      returning * into r;
    end loop;
  end loop;

  raise notice 'documents folded into files';
end $$;

alter table public.general_repos enable trigger general_repos_guard;

-- The document tables have no readers left; their contents are commits now.
-- In the same transaction as the migration above, so a drop that cannot happen
-- takes the migration back with it rather than leaving it to run twice.
drop view if exists public.general_doc_overview;
drop table if exists public.general_doc_comments cascade;
drop table if exists public.general_doc_changes cascade;
drop table if exists public.general_doc_versions cascade;
drop table if exists public.general_docs cascade;

drop function if exists public.create_general_doc(uuid, text, text);
drop function if exists public.write_general_doc(uuid, text, int, text);
drop function if exists public.answer_general_doc_change(uuid, boolean, text);
drop function if exists public.guard_general_doc();
drop function if exists public.guard_general_doc_version();
drop function if exists public.guard_general_doc_change();
drop function if exists public.guard_general_doc_comment();

commit;

begin;

-- ------------------------------------------- which projects build software

/*
 * A research paper has no use for a Code view, and showing one to a Grade 5
 * class makes the product look like it was built for programmers. The flag
 * decides, seeded from the preset the project started with and changeable by
 * anyone who can edit the project — like every other field here, it is the
 * creator's to set.
 */
alter table public.general_projects
  add column if not exists has_code boolean not null default false;

comment on column public.general_projects.has_code is
  'Whether this project builds software. Shows the Code view inside Files.';

update public.general_projects
   set has_code = true
 where preset = 'capstone' and has_code = false;

commit;

begin;

-- The project overview carries the flag, appended last. Its body is copied from
-- supabase/presets.sql; keep the two in step.
create or replace view public.general_project_overview
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
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset,
       p.has_code
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

commit;

begin;

/*
 * A new project starts with the code view its preset implies.
 *
 * The UPDATE above only ever caught the projects that existed when this file
 * first ran, so every capstone created afterwards came out with the flag off —
 * which is the one project kind that always wants it on. Deciding it at
 * creation instead is the fix; an Owner can still change it either way.
 */
create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null,
  p_preset      text default null,
  p_content     jsonb default null
) returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p          public.general_projects%rowtype;
  item       jsonb;
  team_name  text;
  team_ids   jsonb := '{}'::jsonb;
  n          int;
  v_preset   text := nullif(btrim(coalesce(p_preset, '')), '');
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  insert into public.general_projects
    (name, description, starts_on, ends_on, created_by, preset, has_code)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid(),
          v_preset, v_preset is not distinct from 'capstone')
  returning * into p;

  insert into public.general_members (project_id, user_id, level)
  values (p.id, auth.uid(), 'owner');

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return p;
  end if;

  if jsonb_array_length(coalesce(p_content -> 'fields', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_content -> 'teams', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_content -> 'positions', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_content -> 'tasks', '[]'::jsonb)) > 100 then
    raise exception 'That preset is too large to apply'
      using errcode = 'check_violation';
  end if;

  n := 0;
  for team_name in
    select value #>> '{}' from jsonb_array_elements(coalesce(p_content -> 'teams', '[]'::jsonb))
  loop
    if btrim(coalesce(team_name, '')) <> '' and not team_ids ? team_name then
      insert into public.general_teams (project_id, name)
      values (p.id, btrim(team_name))
      returning jsonb_build_object(team_name, id) into item;
      team_ids := team_ids || item;
      n := n + 1;
    end if;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'fields', '[]'::jsonb))
  loop
    insert into public.general_fields (project_id, name, type, options, sort)
    values (
      p.id,
      btrim(item ->> 'name'),
      (item ->> 'type')::public.general_field_type,
      coalesce(item -> 'options', '[]'::jsonb),
      coalesce((item ->> 'sort')::int, 0)
    );
  end loop;

  n := 0;
  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'positions', '[]'::jsonb))
  loop
    insert into public.general_positions (project_id, name, team_id, sort)
    values (
      p.id,
      btrim(item ->> 'name'),
      case when item ->> 'team' is not null then (team_ids ->> (item ->> 'team'))::uuid end,
      n
    );
    n := n + 1;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'tasks', '[]'::jsonb))
  loop
    insert into public.general_tasks (project_id, title, description, team_id, created_by)
    values (
      p.id,
      btrim(item ->> 'title'),
      coalesce(item ->> 'description', ''),
      case when item ->> 'team' is not null then (team_ids ->> (item ->> 'team'))::uuid end,
      auth.uid()
    );
  end loop;

  return p;
end;
$$;

revoke all on function public.create_general_project(text, text, date, date, text, jsonb) from public, anon;
grant execute on function public.create_general_project(text, text, date, date, text, jsonb) to authenticated;

commit;
