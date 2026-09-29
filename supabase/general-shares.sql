-- Collabify — Shared with me: passing a draft file or folder to a teammate.
--
--   node scripts/db.mjs supabase/general-shares.sql
--
-- A draft is yours alone (general_drafts_own). Sharing hands a copy of part of
-- it to other members of the same project — for a class board that is the
-- group, for a work project its members. Nobody outside the project can be
-- picked, and nobody outside it can read a share.
--
-- A share is a copy as of the moment it was made. Editing, trashing, submitting
-- or renaming the draft afterwards leaves it as it was; sharing the same path
-- with the same person again replaces their older copy. The recipient can open
-- it, download it, copy it into their own draft, or remove it from their list;
-- the sender can stop sharing.
--
-- Every write goes through the functions below. A class board's frozen state
-- (handed in, closed, archived) refuses a new share through the same
-- guard_class_board_files trigger class-files.sql puts on the draft tables.
--
-- Uploaded files keep their Storage object: storage_orphans (storage-sweep.sql)
-- counts every storage_path in general_shares.files as used. Any member already
-- reads <project>/files/…, so no Storage policy changes.
--
-- Runs after class-files.sql and teaching-guards.sql, before storage-sweep.sql
-- (whose storage_orphans reads general_shares).
-- Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'file_shared';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_shares (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  repo_id    uuid not null references public.general_repos (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  path       text not null,
  -- [{path, kind, content, storage_path}], the same shape a review's files have.
  files      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint general_shares_type check (type in ('file', 'folder')),
  constraint general_shares_path_len check (char_length(btrim(path)) between 1 and 400),
  constraint general_shares_path_shape check (
    path !~ '^/' and path !~ '\\' and path !~ '(^|/)\.\.(/|$)' and path !~ '/$'
  ),
  constraint general_shares_files_array check (jsonb_typeof(files) = 'array')
);

create index if not exists general_shares_project_idx on public.general_shares (project_id, created_at desc);
create index if not exists general_shares_sender_idx on public.general_shares (sender_id, path);

create table if not exists public.general_share_recipients (
  share_id   uuid not null references public.general_shares (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, user_id)
);

create index if not exists general_share_recipients_user_idx on public.general_share_recipients (user_id);

-- ---------------------------------------------------------------- who reads

/**
 * Whether the caller may see a share: still on its project, and either the
 * sender or one of the people it went to. Security definer so the two tables'
 * policies can ask about each other without recursing.
 */
create or replace function public.general_share_readable(p_share uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_shares s
     where s.id = p_share
       and public.is_general_member(s.project_id)
       and (s.sender_id = auth.uid()
            or exists (select 1 from public.general_share_recipients r
                        where r.share_id = s.id and r.user_id = auth.uid()))
  );
$$;

alter table public.general_shares enable row level security;
alter table public.general_share_recipients enable row level security;

drop policy if exists general_shares_read on public.general_shares;
create policy general_shares_read on public.general_shares
  for select using (public.general_share_readable(id));

drop policy if exists general_share_recipients_read on public.general_share_recipients;
create policy general_share_recipients_read on public.general_share_recipients
  for select using (public.general_share_readable(share_id));

revoke all on public.general_shares, public.general_share_recipients from public, anon, authenticated;
grant select on public.general_shares, public.general_share_recipients to authenticated;
revoke all on function public.general_share_readable(uuid) from public, anon;
grant execute on function public.general_share_readable(uuid) to authenticated;

-- A handed-in, closed or archived class board takes no new shares.
drop trigger if exists general_shares_class_board on public.general_shares;
create trigger general_shares_class_board before insert or update on public.general_shares
  for each row execute function public.guard_class_board_files();

commit;

begin;

-- ---------------------------------------------------------------- rpcs

/**
 * Shares a file or folder from the caller's draft with some of the project's
 * other members. Returns the new share.
 */
create or replace function public.share_general_draft_path(
  p_repo       uuid,
  p_path       text,
  p_folder     boolean,
  p_recipients uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r       public.general_repos%rowtype;
  d       public.general_drafts%rowtype;
  v_path  text := btrim(coalesce(p_path, ''));
  v_to    uuid[];
  v_files jsonb;
  v_share uuid;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'Those files are gone' using errcode = 'no_data_found';
  end if;
  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(distinct x) into v_to from unnest(coalesce(p_recipients, '{}')) x where x is not null;
  if v_to is null or cardinality(v_to) = 0 then
    raise exception 'Choose at least one member to share with' using errcode = 'invalid_parameter_value';
  end if;
  if auth.uid() = any (v_to) then
    raise exception 'You cannot share with yourself. Choose another member.'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_to) x
              where not exists (select 1 from public.general_members m
                                 where m.project_id = r.project_id and m.user_id = x)) then
    raise exception 'You can only share with members of this project'
      using errcode = 'insufficient_privilege';
  end if;

  select * into d from public.general_drafts where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'Your draft is empty, so there is nothing to share' using errcode = 'no_data_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', f.path, 'kind', f.kind, 'content', f.content, 'storage_path', f.storage_path)
           order by f.path), '[]'::jsonb)
    into v_files
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and f.action <> 'removed'
     and (case when p_folder then left(f.path, char_length(v_path) + 1) = v_path || '/'
               else f.path = v_path end);

  if jsonb_array_length(v_files) = 0 then
    raise exception 'That is not in your draft any more. Refresh and try again.'
      using errcode = 'no_data_found';
  end if;

  -- Sharing a path again replaces what these people had of it before.
  delete from public.general_share_recipients sr
   using public.general_shares s
   where s.id = sr.share_id
     and s.repo_id = p_repo and s.sender_id = auth.uid() and s.path = v_path
     and sr.user_id = any (v_to);
  delete from public.general_shares s
   where s.repo_id = p_repo and s.sender_id = auth.uid() and s.path = v_path
     and not exists (select 1 from public.general_share_recipients sr where sr.share_id = s.id);

  insert into public.general_shares (project_id, repo_id, sender_id, type, path, files)
  values (r.project_id, p_repo, auth.uid(), case when p_folder then 'folder' else 'file' end, v_path, v_files)
  returning id into v_share;

  insert into public.general_share_recipients (share_id, user_id)
  select v_share, x from unnest(v_to) x;

  return v_share;
end;
$$;

/** The sender takes a share back from everybody it went to. */
create or replace function public.unshare_general_share(p_share uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.general_shares where id = p_share and sender_id = auth.uid();
  if not found then
    raise exception 'Only whoever shared it can stop sharing it' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/** A recipient takes a share off their own list. */
create or replace function public.dismiss_general_share(p_share uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.general_share_recipients where share_id = p_share and user_id = auth.uid();
  if not found then
    raise exception 'That is not shared with you' using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_shares s
   where s.id = p_share
     and not exists (select 1 from public.general_share_recipients r where r.share_id = s.id);
end;
$$;

/**
 * Copies a share into the caller's own draft. Nothing already in the draft is
 * replaced: if a path is taken, nothing is copied and the error names it.
 */
create or replace function public.copy_general_share_to_draft(p_share uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  s       public.general_shares%rowtype;
  d       public.general_drafts%rowtype;
  v_taken text;
  v_count int;
begin
  select * into s from public.general_shares where id = p_share;
  if not found
     or not exists (select 1 from public.general_share_recipients r
                     where r.share_id = p_share and r.user_id = auth.uid())
     or not public.is_general_member(s.project_id) then
    raise exception 'That is not shared with you' using errcode = 'insufficient_privilege';
  end if;

  d := public.my_general_draft(s.repo_id);

  select string_agg(f.path, ', ' order by f.path) into v_taken
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.path in (select x ->> 'path' from jsonb_array_elements(s.files) x);
  if v_taken is not null then
    raise exception 'Your draft already has %. Move or rename it, then copy again.', v_taken
      using errcode = 'unique_violation';
  end if;

  insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
  select d.id, d.project_id, x ->> 'path',
         (case when exists (select 1 from public.general_repo_tree t
                             where t.repo_id = s.repo_id and t.path = x ->> 'path')
               then 'changed' else 'added' end)::public.general_file_action,
         (x ->> 'kind')::public.general_file_kind,
         coalesce(x ->> 'content', ''),
         x ->> 'storage_path'
    from jsonb_array_elements(s.files) x;
  get diagnostics v_count = row_count;

  update public.general_drafts set updated_at = now() where id = d.id;
  return v_count;
end;
$$;

revoke all on function public.share_general_draft_path(uuid, text, boolean, uuid[]) from public, anon;
revoke all on function public.unshare_general_share(uuid) from public, anon;
revoke all on function public.dismiss_general_share(uuid) from public, anon;
revoke all on function public.copy_general_share_to_draft(uuid) from public, anon;
grant execute on function public.share_general_draft_path(uuid, text, boolean, uuid[]) to authenticated;
grant execute on function public.unshare_general_share(uuid) to authenticated;
grant execute on function public.dismiss_general_share(uuid) to authenticated;
grant execute on function public.copy_general_share_to_draft(uuid) to authenticated;

-- ---------------------------------------------------------------- notice

/** Tells each person a share went to. A class board's notice opens the class project. */
create or replace function public.notify_file_shared()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s        public.general_shares%rowtype;
  board    public.project_boards%rowtype;
  cls_proj public.projects%rowtype;
begin
  select * into s from public.general_shares where id = new.share_id;
  if s.id is null or new.user_id = s.sender_id then return new; end if;
  select b.* into board from public.project_boards b
    join public.general_projects gp on gp.class_board_id = b.id
   where gp.id = s.project_id;
  if board.id is not null then
    select * into cls_proj from public.projects where id = board.project_id;
  end if;

  insert into public.notifications (user_id, type, general_project_id, class_id, project_id, title, preview)
  select new.user_id, 'file_shared',
         case when board.id is null then s.project_id end,
         cls_proj.class_id, cls_proj.id,
         regexp_replace(s.path, '^.*/', ''),
         public.display_name(s.sender_id) || ' shared a ' || s.type || ' with you'
    from public.notification_prefs np
   where np.user_id = new.user_id and np.submissions;
  return new;
end;
$$;

revoke all on function public.notify_file_shared() from public, anon;

drop trigger if exists general_share_recipients_notify on public.general_share_recipients;
create trigger general_share_recipients_notify after insert on public.general_share_recipients
  for each row execute function public.notify_file_shared();

commit;

begin;

do $$
declare
  t text;
begin
  foreach t in array array['general_shares', 'general_share_recipients'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
