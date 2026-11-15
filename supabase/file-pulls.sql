-- supabase/file-pulls.sql
-- Word file pulls: pull before you edit in Word, and a push made from a copy
-- Main has moved past is held, like a stale push on GitHub.
--
--   node scripts/db.mjs supabase/file-pulls.sql supabase/anon-lockdown.sql
--
-- Collabify cannot merge two Word files. So when someone downloads a Word file
-- from Main to edit it (Edit in Word), the app calls pull_general_file, which
-- records who pulled which path and the Main version (base_seq) they got. One
-- row per person and path; pulling again refreshes it. Other people see the
-- live rows as a heads-up ("Ana pulled this 2 hours ago"), never as a lock.
--
-- A pull is live for 7 days. An older row counts as no pull everywhere: the
-- select policy and general_file_push_state read
-- pulled_at > now() - interval '7 days'.
--
-- The hold lives with the uploaded copy, not with the pull. Every Word upload
-- records the Main version it was made from in general_file_bases, keyed by
-- the uploaded object's storage path (record_general_file_base, called right
-- after the upload): the pull's base when there is a live pull, else Main's
-- version at the time (the person chose to continue, or to replace anyway).
-- Refreshing, ending or outliving a pull therefore never lifts a hold, and a
-- folder Submit or Commit that carries the copy is held like the file alone.
-- The base is the uploader's claim: a collaboration safeguard, not a security
-- boundary (Replace anyway exists), so only the uploader may re-record it.
--
-- The guard is a BEFORE INSERT trigger on general_blobs, so it covers every
-- way into Main (commit_general_files directly, commit_general_draft_path and
-- a merged review change) without redefining any of them. When a binary
-- blob's storage path has a base on record for the same repo and path, and
-- Main holds a newer version of the path than that base, the blob is refused
-- with a message the app matches by its prefix "Main has a newer version of".
-- No base on record: it passes. A blob that lands ends its author's pull on
-- that path (AFTER INSERT); that only clears the heads-up.
--
-- No write policy on either table: rows are written only by the functions
-- here and the triggers. Runs after space-look.sql and before
-- anon-lockdown.sql. Nothing else redefines these tables, their policies, the
-- functions or the triggers. Idempotent. Suite: supabase/tests/file-pulls.test.sql

begin;

create table if not exists public.general_file_pulls (
  repo_id    uuid not null,
  project_id uuid not null,
  path       text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  base_seq   int not null,
  pulled_at  timestamptz not null default now(),
  primary key (repo_id, path, user_id),
  foreign key (repo_id, project_id) references public.general_repos (id, project_id) on delete cascade
);

comment on table public.general_file_pulls is
  'Who pulled a Word file from Main to edit, and from which version. Live for 7 days.';

alter table public.general_file_pulls enable row level security;

drop policy if exists general_file_pulls_select on public.general_file_pulls;
create policy general_file_pulls_select on public.general_file_pulls
  for select to authenticated
  using (public.can_read_general_project(project_id) and pulled_at > now() - interval '7 days');

revoke all on table public.general_file_pulls from public, anon, authenticated;
grant select on table public.general_file_pulls to authenticated;
grant all on table public.general_file_pulls to service_role;

create table if not exists public.general_file_bases (
  storage_path text primary key,
  repo_id      uuid not null,
  project_id   uuid not null,
  path         text not null,
  user_id      uuid default auth.uid() references public.profiles (id) on delete set null,
  base_seq     int not null,
  created_at   timestamptz not null default now(),
  foreign key (repo_id, project_id) references public.general_repos (id, project_id) on delete cascade
);

comment on table public.general_file_bases is
  'The Main version an uploaded Word copy was made from, by its storage path. Holds a push from a copy Main has moved past.';

alter table public.general_file_bases enable row level security;

drop policy if exists general_file_bases_select on public.general_file_bases;
create policy general_file_bases_select on public.general_file_bases
  for select to authenticated
  using (public.can_read_general_project(project_id));

revoke all on table public.general_file_bases from public, anon, authenticated;
grant select on table public.general_file_bases to authenticated;
grant all on table public.general_file_bases to service_role;

/**
 * Main's newest seq for a path (any action, a removal included), below
 * p_before when given; 0 when Main never had it. Runs as the caller, so it
 * sees only blobs the caller reads.
 */
create or replace function public.general_main_seq(p_repo uuid, p_path text, p_before int default null)
 returns int
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(max(b.seq), 0)
    from public.general_blobs b
   where b.repo_id = p_repo
     and b.path = btrim(p_path)
     and (p_before is null or b.seq < p_before);
$function$;

/**
 * Records the caller's pull of a Word file in Main. With p_from_main, or with
 * no live pull, the base becomes Main's current version; otherwise only the
 * time is refreshed, so downloading the same copy again keeps its base.
 */
create or replace function public.pull_general_file(p_repo uuid, p_path text, p_from_main boolean)
 returns public.general_file_pulls
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r      public.general_repos%rowtype;
  p      public.general_file_pulls%rowtype;
  v_path text := btrim(p_path);
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'That repository is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_path is null or v_path !~* '\.(docx|doc|odt|rtf)$' then
    raise exception 'Only a Word file is pulled to edit in Word.' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce((
       select b.action <> 'removed'
         from public.general_blobs b
        where b.repo_id = r.id and b.path = v_path
        order by b.seq desc
        limit 1), false) is false then
    raise exception 'That file is not in Main yet.' using errcode = 'no_data_found';
  end if;

  if p_from_main or not exists (
       select 1 from public.general_file_pulls f
        where f.repo_id = r.id and f.path = v_path and f.user_id = auth.uid()
          and f.pulled_at > now() - interval '7 days') then
    insert into public.general_file_pulls (repo_id, project_id, path, user_id, base_seq, pulled_at)
    values (r.id, r.project_id, v_path, auth.uid(), public.general_main_seq(r.id, v_path), now())
    on conflict (repo_id, path, user_id) do update
       set project_id = excluded.project_id,
           base_seq = excluded.base_seq,
           pulled_at = excluded.pulled_at
    returning * into p;
  else
    update public.general_file_pulls f
       set pulled_at = now()
     where f.repo_id = r.id and f.path = v_path and f.user_id = auth.uid()
    returning * into p;
  end if;

  return p;
end;
$function$;

/** Ends the caller's own pull of a path (I'm done editing). */
create or replace function public.end_general_file_pull(p_repo uuid, p_path text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from public.general_file_pulls
   where repo_id = p_repo and path = btrim(p_path) and user_id = auth.uid();
$function$;

/**
 * A person's live pull of a path (the caller's by default) next to Main's
 * newest version of it: its seq, the author and time of its commit, and
 * whether it removed the file. No row when there is no live pull, or when the
 * caller cannot read the project.
 */
create or replace function public.general_file_push_state(p_repo uuid, p_path text, p_user uuid default null)
 returns table (base_seq int, main_seq int, main_author uuid, main_at timestamptz, main_removed boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select f.base_seq,
         coalesce(b.seq, 0),
         c.author_id,
         c.created_at,
         coalesce(b.action = 'removed', false)
    from public.general_file_pulls f
    left join lateral (
      select x.seq, x.action, x.commit_id
        from public.general_blobs x
       where x.repo_id = f.repo_id and x.path = f.path
       order by x.seq desc
       limit 1
    ) b on true
    left join public.general_commits c on c.id = b.commit_id
   where f.repo_id = p_repo
     and f.path = btrim(p_path)
     and f.user_id = coalesce(p_user, auth.uid())
     and f.pulled_at > now() - interval '7 days'
     and public.can_read_general_project(f.project_id);
$function$;

/**
 * Records the Main version an uploaded Word copy was made from. The caller
 * must be able to change the project, the object must be one of its files and
 * the path a Word file. A copy's base is changed only by whoever recorded it.
 */
create or replace function public.record_general_file_base(p_repo uuid, p_path text, p_storage text, p_base_seq int)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r        public.general_repos%rowtype;
  v_path   text := btrim(p_path);
  v_prefix text;
  n        int;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'That repository is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_path is null or v_path !~* '\.(docx|doc|odt|rtf)$' then
    raise exception 'Only a Word file records the version it was made from.'
      using errcode = 'invalid_parameter_value';
  end if;
  v_prefix := r.project_id::text || '/files/';
  if p_storage is null or left(p_storage, length(v_prefix)) <> v_prefix then
    raise exception 'That upload is not one of this project''s files.' using errcode = 'invalid_parameter_value';
  end if;
  if p_base_seq is null or p_base_seq < 0 or p_base_seq > r.commit_count then
    raise exception 'That version is not in Main.' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.general_file_bases (storage_path, repo_id, project_id, path, user_id, base_seq, created_at)
  values (p_storage, r.id, r.project_id, v_path, auth.uid(), p_base_seq, now())
  on conflict (storage_path) do update
     set repo_id = excluded.repo_id,
         project_id = excluded.project_id,
         path = excluded.path,
         base_seq = excluded.base_seq,
         created_at = excluded.created_at
   where public.general_file_bases.user_id = auth.uid();
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Someone else uploaded that copy, so only they can change which version it was made from.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$function$;

/**
 * An uploaded Word copy's base next to Main's newest version of its path: its
 * seq, the author and time of its commit, and whether it removed the file. No
 * row when the copy has no base on record, or the caller cannot read it.
 */
create or replace function public.general_file_base_state(p_storage text)
 returns table (base_seq int, main_seq int, main_author uuid, main_at timestamptz, main_removed boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select f.base_seq,
         coalesce(b.seq, 0),
         c.author_id,
         c.created_at,
         coalesce(b.action = 'removed', false)
    from public.general_file_bases f
    left join lateral (
      select x.seq, x.action, x.commit_id
        from public.general_blobs x
       where x.repo_id = f.repo_id and x.path = f.path
       order by x.seq desc
       limit 1
    ) b on true
    left join public.general_commits c on c.id = b.commit_id
   where f.storage_path = p_storage
     and public.can_read_general_project(f.project_id);
$function$;

/**
 * Holds a binary blob whose uploaded copy was made from an older version of
 * its path than Main now has. Every way into Main inserts its blobs here.
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
  if new.kind <> 'binary' or new.storage_path is null then
    return new;
  end if;

  select f.base_seq into v_base
    from public.general_file_bases f
   where f.storage_path = new.storage_path
     and f.repo_id = new.repo_id
     and f.path = new.path;

  if found and public.general_main_seq(new.repo_id, new.path, new.seq) > v_base then
    raise exception 'Main has a newer version of % than the copy this was made from. Get the newer version, combine the two in Word, then upload again.', new.path
      using errcode = 'serialization_failure';
  end if;

  return new;
end;
$function$;

/** A blob that lands ends its author's pull on that path. */
create or replace function public.general_blobs_pull_end()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  delete from public.general_file_pulls f
   using public.general_commits c
   where c.id = new.commit_id
     and f.repo_id = new.repo_id and f.path = new.path and f.user_id = c.author_id;
  return null;
end;
$function$;

drop trigger if exists general_blobs_pull_guard on public.general_blobs;
create trigger general_blobs_pull_guard
  before insert on public.general_blobs
  for each row execute function public.general_blobs_pull_guard();

drop trigger if exists general_blobs_pull_end on public.general_blobs;
create trigger general_blobs_pull_end
  after insert on public.general_blobs
  for each row execute function public.general_blobs_pull_end();

revoke all on function public.general_main_seq(uuid, text, int) from public, anon;
revoke all on function public.pull_general_file(uuid, text, boolean) from public, anon;
revoke all on function public.end_general_file_pull(uuid, text) from public, anon;
revoke all on function public.general_file_push_state(uuid, text, uuid) from public, anon;
revoke all on function public.record_general_file_base(uuid, text, text, int) from public, anon;
revoke all on function public.general_file_base_state(text) from public, anon;
revoke all on function public.general_blobs_pull_guard() from public, anon, authenticated;
revoke all on function public.general_blobs_pull_end() from public, anon, authenticated;
grant execute on function public.general_main_seq(uuid, text, int) to authenticated, service_role;
grant execute on function public.pull_general_file(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.end_general_file_pull(uuid, text) to authenticated, service_role;
grant execute on function public.general_file_push_state(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.record_general_file_base(uuid, text, text, int) to authenticated, service_role;
grant execute on function public.general_file_base_state(text) to authenticated, service_role;

commit;
