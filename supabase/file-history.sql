-- supabase/file-history.sql
-- File history: revert a commit, undo one file's change, and restore a file to
-- an earlier version, each as a new commit in Main.
--
--   node scripts/db.mjs supabase/file-history.sql supabase/anon-lockdown.sql
--
-- A commit is never edited or deleted. revert_general_commit puts every file a
-- commit touched (or only p_path) back to its state just before that commit:
-- the newest blob for the path with a lower seq. No such blob, or a removal,
-- means the file goes; a file the commit removed comes back with its old
-- content; anything else is changed back. A revert never combines an old
-- version with later edits: when a later commit touched any of those files it
-- refuses and names them, and the person restores each file from its history
-- instead. A file already as it was is skipped; when none is left the revert
-- is refused.
--
-- restore_general_file puts one path back to its state at version p_seq (a
-- blob of that path at that seq, not a removal): changed when the file is in
-- Main, added when it is gone. Restoring to what is already there is refused.
--
-- Both build their files on the server and call commit_general_files once, so
-- rights (commit_main), the active check, the caller's base seq and the file
-- rules stay that function's. They check the project first (not readable:
-- "gone"; archived: refused; no commit_main: refused) so a refusal that names
-- files never reaches someone who cannot commit. A binary version reuses its
-- original Storage object, so nothing is copied and its PDF preview already
-- exists. Each writes one general_commit_origins row (kind, the commit reverted
-- or restored from, its seq, the path for a one-file revert or a restore). No
-- write policy: only these functions write it.
--
-- The upload check: general_blobs_pull_guard gains one rule before its base
-- lookup, for these two functions only. Each sets the transaction flag
-- collabify.file_history_put_back to 'on' just around its commit_general_files
-- call and back to 'off' right after. While it is on, a binary blob whose
-- storage_path already appears on an earlier blob of the same repo and path
-- passes: the function picked a version Main already had, not a stale copy.
-- Every other way into Main (a direct commit, a draft or share copy, a merged
-- change) keeps the base check, so an object Main once had at the path, from
-- a base older than Main's newest version, is still held. An object Main had
-- only under another path is checked even during a put-back.
--
-- Runs after word-previews.sql and before anon-lockdown.sql. It takes
-- ownership of general_blobs_pull_guard from file-pulls.sql, so re-running
-- file-pulls.sql means re-running this file afterwards (then anon-lockdown.sql).
-- The pull-end trigger stays file-pulls.sql's. Idempotent.
-- Suite: supabase/tests/file-history.test.sql

begin;

create table if not exists public.general_commit_origins (
  commit_id        uuid primary key references public.general_commits (id) on delete cascade,
  project_id       uuid not null,
  kind             text not null check (kind in ('revert', 'restore')),
  source_commit_id uuid references public.general_commits (id) on delete set null,
  source_seq       int not null,
  path             text,
  created_at       timestamptz not null default now()
);

comment on table public.general_commit_origins is
  'Where a revert or restore commit came from: the commit reverted or restored from, its seq, and the path (null for a whole-commit revert).';

create index if not exists general_commit_origins_project_idx on public.general_commit_origins (project_id);
create index if not exists general_commit_origins_source_idx on public.general_commit_origins (source_commit_id);

alter table public.general_commit_origins enable row level security;

drop policy if exists general_commit_origins_select on public.general_commit_origins;
create policy general_commit_origins_select on public.general_commit_origins
  for select to authenticated
  using (public.is_general_member(project_id));

drop policy if exists general_commit_origins_class_teacher_read on public.general_commit_origins;
create policy general_commit_origins_class_teacher_read on public.general_commit_origins
  for select to authenticated
  using (public.class_board_teacher_reads(project_id));

revoke all on table public.general_commit_origins from public, anon, authenticated;
grant select on table public.general_commit_origins to authenticated;
grant all on table public.general_commit_origins to service_role;

/**
 * The commit file that takes a path from p_now (its newest blob, null when
 * Main never had it) to p_to (the version wanted, null or a removal for gone),
 * or null when it is already there: both gone, or both live with the same
 * kind, content and storage path. A removal carries the object it drops.
 */
create or replace function public.general_history_item(p_path text, p_now public.general_blobs, p_to public.general_blobs)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when coalesce(p_to.action::text, 'removed') = 'removed' then
      case when coalesce(p_now.action::text, 'removed') = 'removed' then null
           else jsonb_build_object('path', p_path, 'action', 'removed', 'kind', p_now.kind,
                                   'content', '', 'storage_path', p_now.storage_path)
      end
    when coalesce(p_now.action::text, 'removed') = 'removed' then
      jsonb_build_object('path', p_path, 'action', 'added', 'kind', p_to.kind,
                         'content', p_to.content, 'storage_path', p_to.storage_path)
    when p_now.kind = p_to.kind and p_now.content = p_to.content
         and p_now.storage_path is not distinct from p_to.storage_path then null
    else
      jsonb_build_object('path', p_path, 'action', 'changed', 'kind', p_to.kind,
                         'content', p_to.content, 'storage_path', p_to.storage_path)
  end;
$function$;

/**
 * Reverts a commit (or only p_path in it) as a new commit in Main, from the
 * caller's loaded base seq. Refuses, naming the files, when a later commit
 * touched any of them.
 */
create or replace function public.revert_general_commit(
  p_commit uuid, p_base_seq int, p_path text default null, p_message text default '')
 returns public.general_commits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c       public.general_commits%rowtype;
  v_path  text := nullif(btrim(coalesce(p_path, '')), '');
  v_msg   text := btrim(coalesce(p_message, ''));
  v_later text[];
  v_items jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_new   public.general_commits%rowtype;
  t       public.general_blobs%rowtype;
  v_was   public.general_blobs%rowtype;
begin
  select * into c from public.general_commits where id = p_commit;
  if not found
     or not (public.is_general_member(c.project_id) or public.class_board_teacher_reads(c.project_id)) then
    raise exception 'That commit is gone. Reload the history and try again.' using errcode = 'no_data_found';
  end if;
  if public.general_is_archived(c.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not public.general_viewer_active() or not public.general_can(c.project_id, 'commit_main') then
    raise exception 'You cannot commit to Main. Submit your draft for review instead, or ask for Commit to Main.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_path is not null and not exists (
       select 1 from public.general_blobs b where b.commit_id = c.id and b.path = v_path) then
    raise exception '#% did not change %. Pick a file from that commit.', c.seq, v_path
      using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(b.path order by b.path) into v_later
    from public.general_blobs b
   where b.commit_id = c.id
     and (v_path is null or b.path = v_path)
     and exists (select 1 from public.general_blobs x
                  where x.repo_id = c.repo_id and x.path = b.path and x.seq > c.seq);
  if v_later is not null then
    raise exception 'Later commits changed %. Restore each file from its history instead.',
      array_to_string(v_later, ', ')
      using errcode = 'serialization_failure';
  end if;

  -- With no later blob, each file's current state is the commit's own blob.
  for t in
    select * from public.general_blobs b
     where b.commit_id = c.id and (v_path is null or b.path = v_path)
     order by b.path
  loop
    -- No row sets every field to null: Main never had the file before.
    select * into v_was
      from public.general_blobs x
     where x.repo_id = c.repo_id and x.path = t.path and x.seq < c.seq
     order by x.seq desc
     limit 1;
    v_item := public.general_history_item(t.path, t, v_was);
    if v_item is not null then
      v_items := v_items || jsonb_build_array(v_item);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    if v_path is null then
      raise exception 'Nothing to revert. Every file in #% is already as it was before it.', c.seq
        using errcode = 'invalid_parameter_value';
    end if;
    raise exception 'Nothing to undo. % is already as it was before #%.', v_path, c.seq
      using errcode = 'invalid_parameter_value';
  end if;

  if v_msg = '' then
    v_msg := case
      when v_path is not null then left(format('Undo #%s on %s', c.seq, v_path), 2000)
      when btrim(c.message) = '' then format('Revert #%s', c.seq)
      else left(format('Revert #%s: %s', c.seq, btrim(c.message)), 2000)
    end;
  end if;

  -- The flag lets the versions picked above past the upload check. A refusal
  -- inside commit_general_files aborts the transaction (or the caller's
  -- subtransaction, which rolls the setting back), so it never stays on.
  perform set_config('collabify.file_history_put_back', 'on', true);
  v_new := public.commit_general_files(c.repo_id, v_msg, p_base_seq, v_items);
  perform set_config('collabify.file_history_put_back', 'off', true);

  insert into public.general_commit_origins (commit_id, project_id, kind, source_commit_id, source_seq, path)
  values (v_new.id, v_new.project_id, 'revert', c.id, c.seq, v_path);

  return v_new;
end;
$function$;

/**
 * Restores one path to its state at version p_seq as a new commit in Main,
 * from the caller's loaded base seq. Brings back a deleted file too.
 */
create or replace function public.restore_general_file(
  p_repo uuid, p_path text, p_seq int, p_base_seq int, p_message text default '')
 returns public.general_commits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r      public.general_repos%rowtype;
  v_path text := btrim(coalesce(p_path, ''));
  v_msg  text := btrim(coalesce(p_message, ''));
  v_to   public.general_blobs%rowtype;
  v_now  public.general_blobs%rowtype;
  v_item jsonb;
  v_new  public.general_commits%rowtype;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found
     or not (public.is_general_member(r.project_id) or public.class_board_teacher_reads(r.project_id)) then
    raise exception 'That repository is gone. Reload the page and try again.' using errcode = 'no_data_found';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not public.general_viewer_active() or not public.general_can(r.project_id, 'commit_main') then
    raise exception 'You cannot commit to Main. Submit your draft for review instead, or ask for Commit to Main.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_path = '' then
    raise exception 'Pick a file to restore.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_to from public.general_blobs b
   where b.repo_id = r.id and b.path = v_path and b.seq = p_seq;
  if not found then
    raise exception '#% did not change %. Pick a version from the file''s history.', p_seq, v_path
      using errcode = 'no_data_found';
  end if;
  if v_to.action = 'removed' then
    raise exception '#% removed %, so it has nothing to put back. Pick a version that has the file.', p_seq, v_path
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_now from public.general_blobs b
   where b.repo_id = r.id and b.path = v_path
   order by b.seq desc
   limit 1;

  v_item := public.general_history_item(v_path, v_now, v_to);
  if v_item is null then
    raise exception '% is already as it was at #%. Pick another version.', v_path, p_seq
      using errcode = 'invalid_parameter_value';
  end if;

  if v_msg = '' then
    v_msg := format('Restore %s to #%s', v_path, p_seq);
  end if;

  -- See revert_general_commit: on only for this one call.
  perform set_config('collabify.file_history_put_back', 'on', true);
  v_new := public.commit_general_files(r.id, v_msg, p_base_seq, jsonb_build_array(v_item));
  perform set_config('collabify.file_history_put_back', 'off', true);

  insert into public.general_commit_origins (commit_id, project_id, kind, source_commit_id, source_seq, path)
  values (v_new.id, v_new.project_id, 'restore', v_to.commit_id, p_seq, v_path);

  return v_new;
end;
$function$;

/**
 * Holds a binary blob whose uploaded copy was made from an older version of
 * its path than Main now has. Every way into Main inserts its blobs here. A
 * version Main already had for this path passes only while a revert or
 * restore is putting it back (collabify.file_history_put_back is on).
 */
create or replace function public.general_blobs_pull_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_base int;
begin
  -- A removal (deleting the file, or the old path of a renamed folder) carries
  -- the object it drops; it is not a push of an old copy, so it is never held.
  if new.kind <> 'binary' or new.storage_path is null or new.action = 'removed' then
    return new;
  end if;

  -- During a revert or restore, an object Main already had at this path is a
  -- version of it, not a stale copy. Anywhere else the same object is a copy
  -- (a share keeps the sharer's object) and its base decides.
  if coalesce(current_setting('collabify.file_history_put_back', true), 'off') = 'on'
     and exists (
       select 1 from public.general_blobs b
        where b.repo_id = new.repo_id
          and b.path = new.path
          and b.storage_path = new.storage_path
          and b.seq < new.seq) then
    return new;
  end if;

  select f.base_seq into v_base
    from public.general_file_bases f
   where f.storage_path = new.storage_path
     and f.repo_id = new.repo_id
     and f.path = new.path;

  if found and public.general_main_seq(new.repo_id, new.path, new.seq) > v_base then
    raise exception 'Main has a newer version of % than the copy this was made from. Get the newer version, combine the two in Word or Excel, then upload again.', new.path
      using errcode = 'serialization_failure';
  end if;

  return new;
end;
$function$;

drop trigger if exists general_blobs_pull_guard on public.general_blobs;
create trigger general_blobs_pull_guard
  before insert on public.general_blobs
  for each row execute function public.general_blobs_pull_guard();

revoke all on function public.general_history_item(text, public.general_blobs, public.general_blobs)
  from public, anon, authenticated;
revoke all on function public.revert_general_commit(uuid, int, text, text) from public, anon;
revoke all on function public.restore_general_file(uuid, text, int, int, text) from public, anon;
revoke all on function public.general_blobs_pull_guard() from public, anon, authenticated;
grant execute on function public.revert_general_commit(uuid, int, text, text) to authenticated, service_role;
grant execute on function public.restore_general_file(uuid, text, int, int, text) to authenticated, service_role;

commit;
