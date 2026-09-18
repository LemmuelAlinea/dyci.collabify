-- Shared documents for General projects.
--
-- The answer to "a research paper is a project too". A document lives in the
-- project, everybody on it can read, and how a change gets in depends on what
-- the person may do:
--
--   * `edit_files` — write straight to the document. Every write is a version.
--   * anybody else  — propose a change, which somebody with `edit_files`
--                     reviews, comments on, and applies or declines.
--
-- A version is never edited and never deleted, so the history is the record.
-- A proposal carries the version it was written against, so applying one that
-- has gone stale is refused rather than silently overwriting somebody's work.
--
-- Depends on supabase/general.sql for general_can, general_is_archived,
-- general_viewer_active and is_general_member.
--
-- Idempotent. Safe to re-run.

begin;

do $$ begin
  create type public.general_change_status as enum
    ('open', 'applied', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

commit;

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_docs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  title       text not null,
  -- Denormalised so a list of documents does not need the versions table.
  version     int not null default 1,
  created_by  uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_docs_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint general_docs_version check (version >= 1),
  constraint general_docs_id_project unique (id, project_id)
);

create index if not exists general_docs_project_idx on public.general_docs (project_id);

/*
 * Immutable. A version is written once and then only read — that is what makes
 * the history worth trusting. The guard below refuses every update and delete.
 */
create table if not exists public.general_doc_versions (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  version    int not null,
  body       text not null default '',
  note       text not null default '',
  author_id  uuid references public.profiles (id) on delete set null,
  /** Set when this version came from an applied proposal. */
  change_id  uuid,
  created_at timestamptz not null default now(),
  constraint general_doc_versions_body_len check (char_length(body) <= 400000),
  constraint general_doc_versions_note_len check (char_length(note) <= 500),
  constraint general_doc_versions_unique unique (doc_id, version),
  foreign key (doc_id, project_id)
    references public.general_docs (id, project_id) on delete cascade
);

create index if not exists general_doc_versions_doc_idx
  on public.general_doc_versions (doc_id, version desc);

create table if not exists public.general_doc_changes (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null,
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  -- The version the author started from. Applying against a newer one is refused.
  base_version int not null,
  body         text not null default '',
  note         text not null default '',
  status       public.general_change_status not null default 'open',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  decided_note text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint general_doc_changes_body_len check (char_length(body) <= 400000),
  constraint general_doc_changes_note_len check (char_length(note) <= 2000),
  constraint general_doc_changes_decided_note_len check (char_length(decided_note) <= 2000),
  constraint general_doc_changes_id_project unique (id, project_id),
  foreign key (doc_id, project_id)
    references public.general_docs (id, project_id) on delete cascade
);

create index if not exists general_doc_changes_doc_idx
  on public.general_doc_changes (doc_id, created_at desc);
create index if not exists general_doc_changes_author_idx
  on public.general_doc_changes (author_id);
create index if not exists general_doc_changes_decided_idx
  on public.general_doc_changes (decided_by);

create table if not exists public.general_doc_comments (
  id         uuid primary key default gen_random_uuid(),
  change_id  uuid not null,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint general_doc_comments_body_len check (char_length(btrim(body)) between 1 and 5000),
  foreign key (change_id, project_id)
    references public.general_doc_changes (id, project_id) on delete cascade
);

create index if not exists general_doc_comments_change_idx
  on public.general_doc_comments (change_id, created_at);
create index if not exists general_doc_comments_author_idx
  on public.general_doc_comments (author_id);

drop trigger if exists general_docs_touch on public.general_docs;
create trigger general_docs_touch before update on public.general_docs
  for each row execute function public.touch_updated_at();

drop trigger if exists general_doc_changes_touch on public.general_doc_changes;
create trigger general_doc_changes_touch before update on public.general_doc_changes
  for each row execute function public.touch_updated_at();

commit;

begin;

-- ---------------------------------------------------------------- guards

/*
 * A version is a fact about what the document said. Editing or deleting one
 * would make the history a story rather than a record, so neither is allowed
 * to anybody, including an Owner.
 */
create or replace function public.guard_general_doc_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'A version cannot be changed or removed once it is written'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists general_doc_versions_frozen on public.general_doc_versions;
create trigger general_doc_versions_frozen
  before update or delete on public.general_doc_versions
  for each row execute function public.guard_general_doc_version();

/*
 * Everything below writes through a definer RPC, so these guards catch the
 * direct-table path: an archived project is frozen, and the columns that decide
 * who may do what are not the caller's to set.
 */
create or replace function public.guard_general_doc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id then
      raise exception 'A document cannot move project' using errcode = 'insufficient_privilege';
    end if;
    -- The version counter only ever moves forward, and only through the RPC.
    if new.version < old.version then
      raise exception 'A document cannot go back a version' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists general_docs_guard on public.general_docs;
create trigger general_docs_guard before insert or update on public.general_docs
  for each row execute function public.guard_general_doc();

create or replace function public.guard_general_doc_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj uuid := coalesce(new.project_id, old.project_id);
begin
  if public.general_is_archived(proj) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid() then
      raise exception 'A change is filed by whoever wrote it' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'open' then
      raise exception 'A change starts open' using errcode = 'insufficient_privilege';
    end if;
    if new.decided_by is not null or new.decided_at is not null then
      raise exception 'A change is not decided when it is filed' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id or new.doc_id <> old.doc_id then
      raise exception 'A change cannot move' using errcode = 'insufficient_privilege';
    end if;
    if new.author_id is distinct from old.author_id
       or new.base_version <> old.base_version
       or new.created_at <> old.created_at then
      raise exception 'A change keeps who wrote it and what it was written against'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'open' then
      raise exception 'That change was already answered' using errcode = 'insufficient_privilege';
    end if;
    -- Withdrawing is the author's; applying and declining belong to the RPC,
    -- which sets collabify.general_doc_op.
    if new.status <> 'withdrawn'
       and coalesce(current_setting('collabify.general_doc_op', true), 'off') <> 'on' then
      raise exception 'Use the review buttons to answer a change'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'withdrawn' and old.author_id is distinct from auth.uid() then
      raise exception 'Only whoever wrote a change withdraws it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists general_doc_changes_guard on public.general_doc_changes;
create trigger general_doc_changes_guard before insert or update on public.general_doc_changes
  for each row execute function public.guard_general_doc_change();

create or replace function public.guard_general_doc_comment()
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

drop trigger if exists general_doc_comments_guard on public.general_doc_comments;
create trigger general_doc_comments_guard before insert on public.general_doc_comments
  for each row execute function public.guard_general_doc_comment();

commit;

begin;

-- ---------------------------------------------------------------- policies

alter table public.general_docs          enable row level security;
alter table public.general_doc_versions  enable row level security;
alter table public.general_doc_changes   enable row level security;
alter table public.general_doc_comments  enable row level security;

drop policy if exists general_docs_select on public.general_docs;
create policy general_docs_select on public.general_docs
  for select using (public.is_general_member(project_id));

drop policy if exists general_docs_write on public.general_docs;
create policy general_docs_write on public.general_docs
  for all using (public.general_can(project_id, 'edit_files'))
  with check (public.general_can(project_id, 'edit_files'));

drop policy if exists general_doc_versions_select on public.general_doc_versions;
create policy general_doc_versions_select on public.general_doc_versions
  for select using (public.is_general_member(project_id));

drop policy if exists general_doc_versions_insert on public.general_doc_versions;
create policy general_doc_versions_insert on public.general_doc_versions
  for insert with check (public.general_can(project_id, 'edit_files'));

drop policy if exists general_doc_changes_select on public.general_doc_changes;
create policy general_doc_changes_select on public.general_doc_changes
  for select using (public.is_general_member(project_id));

-- Anybody still on the project may propose. That is the whole point: a Member
-- who cannot write the document can still say what it should say.
drop policy if exists general_doc_changes_insert on public.general_doc_changes;
create policy general_doc_changes_insert on public.general_doc_changes
  for insert with check (
    public.is_general_member(project_id)
    and public.general_viewer_active()
    and not public.general_is_archived(project_id)
  );

drop policy if exists general_doc_changes_update on public.general_doc_changes;
create policy general_doc_changes_update on public.general_doc_changes
  for update using (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  )
  with check (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

drop policy if exists general_doc_comments_select on public.general_doc_comments;
create policy general_doc_comments_select on public.general_doc_comments
  for select using (public.is_general_member(project_id));

drop policy if exists general_doc_comments_insert on public.general_doc_comments;
create policy general_doc_comments_insert on public.general_doc_comments
  for insert with check (
    public.is_general_member(project_id) and public.general_viewer_active()
  );

drop policy if exists general_doc_comments_delete on public.general_doc_comments;
create policy general_doc_comments_delete on public.general_doc_comments
  for delete using (
    (author_id = auth.uid() or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

revoke all on public.general_docs, public.general_doc_versions,
              public.general_doc_changes, public.general_doc_comments from public, anon;
grant select, insert, update, delete on public.general_docs to authenticated;
grant select, insert on public.general_doc_versions to authenticated;
grant select, insert, update on public.general_doc_changes to authenticated;
grant select, insert, delete on public.general_doc_comments to authenticated;

commit;

begin;

-- ---------------------------------------------------------------- rpcs

create or replace function public.create_general_doc(
  p_project uuid,
  p_title   text,
  p_body    text default ''
) returns public.general_docs
language plpgsql security definer set search_path = public as $$
declare
  d public.general_docs%rowtype;
begin
  if not public.general_viewer_active() or not public.general_can(p_project, 'edit_files') then
    raise exception 'You do not have permission to add a document. Ask an Owner for it.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.general_docs (project_id, title, created_by)
  values (p_project, btrim(p_title), auth.uid())
  returning * into d;

  insert into public.general_doc_versions (doc_id, project_id, version, body, note, author_id)
  values (d.id, p_project, 1, coalesce(p_body, ''), 'Created', auth.uid());

  return d;
end;
$$;

/**
 * A direct write. The caller says which version they were looking at, and a
 * newer one means somebody else saved first — refused rather than overwritten.
 */
create or replace function public.write_general_doc(
  p_doc          uuid,
  p_body         text,
  p_base_version int,
  p_note         text default ''
) returns public.general_docs
language plpgsql security definer set search_path = public as $$
declare
  d public.general_docs%rowtype;
begin
  select * into d from public.general_docs where id = p_doc for update;
  if not found then
    raise exception 'That document is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.general_can(d.project_id, 'edit_files') then
    raise exception 'You do not have permission to write to this document. Propose a change instead.'
      using errcode = 'insufficient_privilege';
  end if;

  if d.version <> p_base_version then
    raise exception 'Somebody saved version % while you were writing. Reopen the document and put your wording back.', d.version
      using errcode = 'serialization_failure';
  end if;

  insert into public.general_doc_versions (doc_id, project_id, version, body, note, author_id)
  values (d.id, d.project_id, d.version + 1, coalesce(p_body, ''), left(coalesce(p_note, ''), 500), auth.uid());

  update public.general_docs set version = d.version + 1 where id = d.id
  returning * into d;

  return d;
end;
$$;

/** Applying a proposal is a version like any other, credited to its author. */
create or replace function public.answer_general_doc_change(
  p_change uuid,
  p_apply  boolean,
  p_note   text default ''
) returns public.general_doc_changes
language plpgsql security definer set search_path = public as $$
declare
  c public.general_doc_changes%rowtype;
  d public.general_docs%rowtype;
begin
  select * into c from public.general_doc_changes where id = p_change for update;
  if not found then
    raise exception 'That change is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.general_can(c.project_id, 'edit_files') then
    raise exception 'You do not have permission to answer a change. Ask an Owner for it.'
      using errcode = 'insufficient_privilege';
  end if;

  if c.status <> 'open' then
    raise exception 'That change was already answered' using errcode = 'invalid_parameter_value';
  end if;

  select * into d from public.general_docs where id = c.doc_id for update;

  if p_apply then
    if d.version <> c.base_version then
      raise exception 'This change was written against version % and the document is now on version %. Ask its author to bring it up to date.', c.base_version, d.version
        using errcode = 'serialization_failure';
    end if;

    insert into public.general_doc_versions
      (doc_id, project_id, version, body, note, author_id, change_id)
    values (d.id, d.project_id, d.version + 1, c.body,
            left(coalesce(nullif(btrim(c.note), ''), 'Applied a change'), 500),
            c.author_id, c.id);

    update public.general_docs set version = d.version + 1 where id = d.id;
  end if;

  perform set_config('collabify.general_doc_op', 'on', true);
  update public.general_doc_changes
     set status = case when p_apply then 'applied' else 'declined' end::public.general_change_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decided_note = left(coalesce(p_note, ''), 2000)
   where id = c.id
  returning * into c;
  perform set_config('collabify.general_doc_op', 'off', true);

  return c;
end;
$$;

revoke all on function public.create_general_doc(uuid, text, text) from public, anon;
revoke all on function public.write_general_doc(uuid, text, int, text) from public, anon;
revoke all on function public.answer_general_doc_change(uuid, boolean, text) from public, anon;
grant execute on function public.create_general_doc(uuid, text, text) to authenticated;
grant execute on function public.write_general_doc(uuid, text, int, text) to authenticated;
grant execute on function public.answer_general_doc_change(uuid, boolean, text) to authenticated;

revoke all on function public.guard_general_doc() from public, anon;
revoke all on function public.guard_general_doc_version() from public, anon;
revoke all on function public.guard_general_doc_change() from public, anon;
revoke all on function public.guard_general_doc_comment() from public, anon;

commit;

begin;

-- ---------------------------------------------------------------- views

drop view if exists public.general_doc_overview;
create view public.general_doc_overview
with (security_invoker = true) as
select d.id,
       d.project_id,
       d.title,
       d.version,
       d.created_by,
       d.archived_at,
       d.created_at,
       d.updated_at,
       (select count(*) from public.general_doc_changes c
         where c.doc_id = d.id and c.status = 'open')::int as open_change_count,
       v.author_id as last_author,
       v.created_at as last_written_at,
       length(v.body) as body_length
  from public.general_docs d
  left join lateral (
    select x.author_id, x.created_at, x.body
      from public.general_doc_versions x
     where x.doc_id = d.id
     order by x.version desc
     limit 1
  ) v on true;

grant select on public.general_doc_overview to authenticated;

commit;

begin;

-- Realtime so a reviewer sees a proposal arrive and a writer sees a version
-- land. Comments stay out: a DELETE event is not filtered by RLS, and a comment
-- row's primary key is of no use to anybody who could not already read it.
do $$
declare
  t text;
begin
  foreach t in array array['general_docs', 'general_doc_versions', 'general_doc_changes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
