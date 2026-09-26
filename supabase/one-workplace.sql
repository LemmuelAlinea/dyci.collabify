-- Collabify — one workplace, phase 2: every class is a space.
--
--   node scripts/db.mjs supabase/one-workplace.sql
--
-- A class keeps being the thing a professor creates, edits, archives and
-- deletes. What changes is that it now owns a space of kind 'education', and
-- the space follows it: its name, archive state, Owner and roster are written by
-- the class, never directly. The class's own tables (groups, projects, syllabus
-- weeks, submissions) are untouched; the space is where membership, levels and
-- positions live, the same way they do for a work space.
--
-- Runs after access.sql. Redefines, as supersets: the general_space_overview
-- view (general-spaces.sql), join_class (rate-limit.sql), is_class_professor and
-- the classes_select/classes_update policies (classes.sql), is_set_professor
-- (groups.sql), is_project_professor (projects.sql), is_board_professor
-- (tasks.sql), shares_class_with (removed-visible.sql), can_read_syllabus
-- (syllabus.sql), can_moderate_conversation and start_direct_conversation
-- (messages.sql), list_general_space_members and list_general_project_members
-- (general-spaces.sql). Re-run this file after re-running any of those.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- kind

do $$ begin
  create type public.space_kind as enum ('work', 'education');
exception when duplicate_object then null; end $$;

alter table public.general_spaces
  add column if not exists kind public.space_kind not null default 'work';

comment on column public.general_spaces.kind is
  'education: the space of one class, written only by the class. work: everything else.';

-- ---------------------------------------------------------------- the class's space

alter table public.classes
  add column if not exists space_id uuid references public.general_spaces (id) on delete restrict;

alter table public.classes
  add column if not exists student_cap int;

do $$ begin
  alter table public.classes add constraint classes_student_cap_sane
    check (student_cap is null or student_cap between 1 and 500);
exception when duplicate_object then null; end $$;

comment on column public.classes.student_cap is
  'Most active students the class takes. Null is no limit. join_class enforces it.';

create unique index if not exists classes_space_key on public.classes (space_id);

-- ---------------------------------------------------------------- the sync flag

/**
 * Raised while a class writes its own space, so the guards on the space step
 * aside for it and for nobody else. Transaction-local, and restored to what it
 * was rather than switched off, so one sync running inside another does not
 * open the door early for the rest of the outer one.
 */
create or replace function public.class_sync_on()
returns text language plpgsql as $$
declare
  prev text := coalesce(current_setting('collabify.class_sync', true), 'off');
begin
  perform set_config('collabify.class_sync', 'on', true);
  return prev;
end;
$$;

create or replace function public.class_sync_restore(p_prev text)
returns void language plpgsql as $$
begin
  perform set_config('collabify.class_sync', coalesce(p_prev, 'off'), true);
end;
$$;

create or replace function public.class_syncing()
returns boolean language sql stable as $$
  select coalesce(current_setting('collabify.class_sync', true), 'off') = 'on';
$$;

-- Only the triggers below raise the flag. Nobody calls these over the API.
revoke execute on function public.class_sync_on() from public, anon, authenticated;
revoke execute on function public.class_sync_restore(text) from public, anon, authenticated;

create or replace function public.class_space_name(p_name text, p_section text)
returns text language sql immutable as $$
  select left(btrim(p_name) || ' · ' || btrim(p_section), 80);
$$;

-- ---------------------------------------------------------------- creating a class

/** Before the class row lands: make its space and seat the professor as Owner. */
create or replace function public.class_space_create()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  if new.space_id is not null then
    raise exception 'A class makes its own space' using errcode = 'check_violation';
  end if;

  prev := public.class_sync_on();
  insert into public.general_spaces (name, description, created_by, kind, archived_at)
  values (public.class_space_name(new.name, new.section), coalesce(new.description, ''),
          new.professor_id, 'education', new.archived_at)
  returning id into new.space_id;

  insert into public.general_space_members (space_id, user_id, level)
  values (new.space_id, new.professor_id, 'owner');
  perform public.class_sync_restore(prev);

  return new;
end;
$$;

drop trigger if exists classes_space_create on public.classes;
create trigger classes_space_create before insert on public.classes
  for each row execute function public.class_space_create();

-- ---------------------------------------------------------------- changing a class

/**
 * A class keeps its space for life, and only the program admin (or the SQL
 * console) hands a class to another professor. Filling space_id in for the
 * first time is the backfill below, and is the one change allowed.
 */
create or replace function public.class_space_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'A class keeps its own space' using errcode = 'check_violation';
  end if;
  if new.professor_id is distinct from old.professor_id
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin hands a class to another professor'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_space_guard on public.classes;
create trigger classes_space_guard before update on public.classes
  for each row execute function public.class_space_guard();

/** After the class changes or goes: its space does the same. */
create or replace function public.class_space_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  prev := public.class_sync_on();

  if tg_op = 'DELETE' then
    delete from public.general_spaces where id = old.space_id;
    perform public.class_sync_restore(prev);
    return old;
  end if;

  if new.space_id is not null and (
       new.name is distinct from old.name
       or new.section is distinct from old.section
       or new.description is distinct from old.description
       or new.archived_at is distinct from old.archived_at) then
    update public.general_spaces
       set name        = public.class_space_name(new.name, new.section),
           description = coalesce(new.description, ''),
           archived_at = new.archived_at
     where id = new.space_id;
  end if;

  if new.space_id is not null and new.professor_id is distinct from old.professor_id then
    delete from public.general_space_members
     where space_id = new.space_id and user_id = old.professor_id;
    insert into public.general_space_members (space_id, user_id, level)
    values (new.space_id, new.professor_id, 'owner')
    on conflict (space_id, user_id) do update set level = 'owner';
  end if;

  perform public.class_sync_restore(prev);
  return new;
end;
$$;

drop trigger if exists classes_space_follow on public.classes;
create trigger classes_space_follow after update or delete on public.classes
  for each row execute function public.class_space_follow();

-- ---------------------------------------------------------------- the classes that already exist

do $$
declare
  c    record;
  sid  uuid;
  prev text;
begin
  prev := public.class_sync_on();
  for c in select * from public.classes where space_id is null loop
    insert into public.general_spaces
      (name, description, created_by, kind, archived_at, created_at)
    values (public.class_space_name(c.name, c.section), coalesce(c.description, ''),
            c.professor_id, 'education', c.archived_at, c.created_at)
    returning id into sid;

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    values (sid, c.professor_id, 'owner', c.created_at);

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    select sid, m.student_id, 'member', m.joined_at
      from public.class_members m
     where m.class_id = c.id and m.status = 'active'
    on conflict (space_id, user_id) do nothing;

    update public.classes set space_id = sid where id = c.id;
  end loop;
  perform public.class_sync_restore(prev);
end $$;

alter table public.classes alter column space_id set not null;

-- ---------------------------------------------------------------- the General list

/** general-spaces.sql's view, with the kind on the end. Columns only ever append. */
create or replace view public.general_space_overview
with (security_invoker = true) as
select s.id,
       s.name,
       s.description,
       s.created_by,
       s.archived_at,
       s.created_at,
       s.updated_at,
       m.level as my_level,
       (select count(*) from public.general_space_members x where x.space_id = s.id)::int
         as member_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is null)::int as project_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is not null)::int as archived_count,
       s.kind
  from public.general_spaces s
  left join public.general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

grant select on public.general_space_overview to authenticated;

commit;
