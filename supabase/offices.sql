-- Collabify — offices: the admin files people and work spaces under the school's offices.
--
--   node scripts/db.mjs supabase/offices.sql supabase/anon-lockdown.sql
--
-- An office sits above spaces. A member has one home office, and a work space belongs
-- to one office. A class's space never does: classes are filed by their programme, not
-- by an office. Students and admins have no office.
--
-- Only an active admin writes any of it, and only through the functions below. There is
-- no insert, update or delete policy on the three tables, so the app cannot write them
-- directly. Every write leaves a row in audit_events. audit_events has no office column,
-- so the office's name rides in subject_label or before_value / after_value, and an
-- empty string means no office.
--
-- The admin's overview reads (admin_office_people, admin_office_spaces, admin_org_overview,
-- admin_attention_projects, admin_org_summary) return names and counts only, never a
-- task, comment, file, milestone title or due date.
--
-- Quiet reads general_task_events alone, by choice: comments, time logs and project events
-- don't reset quiet; only person-made task events do.
--
-- Additive: it creates its own tables, triggers, functions and one index on
-- general_task_events, and redefines nothing an earlier file owns. The general_spaces and profiles triggers here are separate triggers,
-- so no existing space or profile trigger changes. Runs before anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it. So they commit on
-- their own first, as access.sql does.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'office_created';
  alter type public.audit_action add value if not exists 'office_renamed';
  alter type public.audit_action add value if not exists 'office_archived';
  alter type public.audit_action add value if not exists 'office_restored';
  alter type public.audit_action add value if not exists 'office_deleted';
  alter type public.audit_action add value if not exists 'office_changed';
  alter type public.audit_action add value if not exists 'space_office_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.offices (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  archived_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint offices_name_length check (char_length(btrim(name)) between 1 and 80)
);

-- Two live offices never share a name, whatever the case or spacing. An archived one may,
-- which is why restoring checks for a clash.
create unique index if not exists offices_live_name
  on public.offices (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  where archived_at is null;

drop trigger if exists offices_touch on public.offices;
create trigger offices_touch before update on public.offices
  for each row execute function public.touch_updated_at();

/** One row per person: their home office. A person without a row has none. */
create table if not exists public.office_members (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  office_id   uuid not null references public.offices (id),
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);

create index if not exists office_members_by_office on public.office_members (office_id);

/** One row per work space: the office it is filed under. */
create table if not exists public.office_spaces (
  space_id    uuid primary key references public.general_spaces (id) on delete cascade,
  office_id   uuid not null references public.offices (id),
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);

create index if not exists office_spaces_by_office on public.office_spaces (office_id);

-- ---------------------------------------------------------------- helpers

/** The key the unique index compares: trimmed, inner spaces collapsed, lower case. */
create or replace function public.office_name_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

/**
 * The live office whose name clashes with p_name, leaving p_except out (the office being
 * renamed or restored). Null when there is none. A clash message names this office, as
 * it is stored, rather than echoing what the admin typed.
 */
create or replace function public.office_live_name(p_name text, p_except uuid)
returns text language sql stable security definer set search_path = public as $$
  select name from public.offices
   where archived_at is null
     and id is distinct from p_except
     and public.office_name_key(name) = public.office_name_key(p_name)
   limit 1;
$$;

/**
 * is_admin() checks the role only. Changing offices also needs the admin's account to be
 * active, so a pending or rejected admin account changes nothing.
 */
create or replace function public.require_office_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'admin' and status = 'active') then
    raise exception 'Only an admin can change offices.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/** Refuses an archived office. Locks it, so archiving cannot race an assignment. */
create or replace function public.office_refuse_archived(p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_archived timestamptz;
begin
  select archived_at into v_archived from public.offices where id = p_office for share;
  if v_archived is not null then
    raise exception 'This office is archived. Restore it first.'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------- row guards

/** Only a member has a home office: never a student, never an admin. */
create or replace function public.office_members_member_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'member') then
    raise exception 'Only members have an office.' using errcode = 'check_violation';
  end if;
  perform public.office_refuse_archived(new.office_id);
  return new;
end;
$$;

drop trigger if exists office_members_member_only on public.office_members;
create trigger office_members_member_only before insert or update on public.office_members
  for each row execute function public.office_members_member_only();

/** Only a work space is filed under an office. A class's space never is. */
create or replace function public.office_spaces_work_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.general_spaces where id = new.space_id and kind = 'work') then
    raise exception 'Only a work space has an office.' using errcode = 'check_violation';
  end if;
  perform public.office_refuse_archived(new.office_id);
  return new;
end;
$$;

drop trigger if exists office_spaces_work_only on public.office_spaces;
create trigger office_spaces_work_only before insert or update on public.office_spaces
  for each row execute function public.office_spaces_work_only();

-- ---------------------------------------------------------------- automatic rows

/**
 * A new work space starts in its creator's home office, so a member's spaces are filed
 * without the admin doing anything. A creator with no office, or an archived one, leaves
 * the space unassigned. It never stops the space being made: the office is locked as it
 * is read, so an archive that lands first is seen and skipped, and one that comes after
 * waits and then counts this space.
 */
create or replace function public.general_spaces_office_default()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_office uuid;
begin
  if new.kind = 'work' and new.created_by is not null then
    select o.id into v_office
      from public.office_members m
      join public.offices o on o.id = m.office_id
     where m.user_id = new.created_by and o.archived_at is null
       for share of o;
    if v_office is not null then
      begin
        insert into public.office_spaces (space_id, office_id, assigned_by)
        values (new.id, v_office, new.created_by)
        on conflict (space_id) do nothing;
      exception when check_violation then
        null; -- the office was archived after all: the space stays unassigned
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists general_spaces_office_default on public.general_spaces;
create trigger general_spaces_office_default after insert on public.general_spaces
  for each row execute function public.general_spaces_office_default();

/**
 * Someone who stops being a member (made a student or an admin) loses their office, and
 * the log says so. A status change keeps it: a reactivated member comes back filed.
 * Watches the column, so every path that changes a role lands here.
 */
create or replace function public.profiles_office_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from 'member' then
    with gone as (
      delete from public.office_members where user_id = new.id returning office_id
    )
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    select 'office_changed', auth.uid(), new.id,
           coalesce(btrim(new.first_name || ' ' || new.last_name), ''), o.name, ''
      from gone join public.offices o on o.id = gone.office_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_office_role on public.profiles;
create trigger profiles_office_role after update of role on public.profiles
  for each row execute function public.profiles_office_role();

-- ---------------------------------------------------------------- reads

alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.office_spaces enable row level security;

revoke all on public.offices from public, anon, authenticated;
revoke all on public.office_members from public, anon, authenticated;
revoke all on public.office_spaces from public, anon, authenticated;
grant select on public.offices to authenticated;
grant select on public.office_members to authenticated;
grant select on public.office_spaces to authenticated;

-- Office names are not private: every signed-in account reads them.
drop policy if exists offices_select on public.offices;
create policy offices_select on public.offices
  for select to authenticated using (true);

drop policy if exists office_members_select on public.office_members;
create policy office_members_select on public.office_members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists office_spaces_select on public.office_spaces;
create policy office_spaces_select on public.office_spaces
  for select to authenticated
  using (public.is_admin() or public.is_general_space_member(space_id));

-- ---------------------------------------------------------------- office lifecycle

create or replace function public.create_office(p_name text, p_description text default '')
returns public.offices language plpgsql security definer set search_path = public as $$
declare
  v_name  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_clash text;
  o       public.offices%rowtype;
begin
  perform public.require_office_admin();

  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the office a name of 1 to 80 characters.'
      using errcode = 'check_violation';
  end if;

  v_clash := public.office_live_name(v_name, null);
  if v_clash is not null then
    raise exception 'An office named % already exists. Pick another name.', v_clash
      using errcode = 'unique_violation';
  end if;

  -- Another admin can take the name between the check and the insert.
  begin
    insert into public.offices (name, description, created_by)
    values (v_name, coalesce(btrim(p_description), ''), auth.uid())
    returning * into o;
  exception when unique_violation then
    raise exception 'An office named % already exists. Pick another name.',
      coalesce(public.office_live_name(v_name, null), v_name)
      using errcode = 'unique_violation';
  end;

  insert into public.audit_events (action, actor_id, subject_id, subject_label)
  values ('office_created', auth.uid(), o.id, o.name);

  return o;
end;
$$;

create or replace function public.rename_office(p_office uuid, p_name text, p_description text)
returns public.offices language plpgsql security definer set search_path = public as $$
declare
  v_name  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_clash text;
  o       public.offices%rowtype;
  v_old   text;
begin
  perform public.require_office_admin();

  select * into o from public.offices where id = p_office for update;
  if o.id is null then
    raise exception 'That office no longer exists. Refresh the page.';
  end if;

  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the office a name of 1 to 80 characters.'
      using errcode = 'check_violation';
  end if;

  v_clash := public.office_live_name(v_name, p_office);
  if v_clash is not null then
    raise exception 'An office named % already exists. Pick another name.', v_clash
      using errcode = 'unique_violation';
  end if;

  v_old := o.name;
  begin
    update public.offices
       set name = v_name, description = coalesce(btrim(p_description), o.description)
     where id = p_office
    returning * into o;
  exception when unique_violation then
    raise exception 'An office named % already exists. Pick another name.',
      coalesce(public.office_live_name(v_name, p_office), v_name)
      using errcode = 'unique_violation';
  end;

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('office_renamed', auth.uid(), o.id, o.name, v_old, o.name);

  return o;
end;
$$;

/**
 * Refused while the office still has active people or live spaces, and the message says
 * how many. Pending, deactivated and rejected people do not block it; their office is
 * cleared. Archived and trashed spaces do not block it either; they keep their row, so
 * they come back filed if restored.
 */
create or replace function public.archive_office(p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o        public.offices%rowtype;
  v_people int;
  v_spaces int;
  v_parts  text[] := '{}';
begin
  perform public.require_office_admin();

  select * into o from public.offices where id = p_office for update;
  if o.id is null then
    raise exception 'That office no longer exists. Refresh the page.';
  end if;
  if o.archived_at is not null then
    return; -- already archived, and saying so twice is not an error
  end if;

  select count(*) into v_people
    from public.office_members m join public.profiles p on p.id = m.user_id
   where m.office_id = p_office and p.status = 'active';
  select count(*) into v_spaces
    from public.office_spaces os join public.general_spaces s on s.id = os.space_id
   where os.office_id = p_office and s.archived_at is null and s.trashed_at is null;

  if v_people > 0 then
    v_parts := v_parts || (v_people || case when v_people = 1 then ' person' else ' people' end);
  end if;
  if v_spaces > 0 then
    v_parts := v_parts || (v_spaces || case when v_spaces = 1 then ' space' else ' spaces' end);
  end if;
  if cardinality(v_parts) > 0 then
    raise exception 'Move its % first.', array_to_string(v_parts, ' and ')
      using errcode = 'check_violation';
  end if;

  with gone as (
    delete from public.office_members where office_id = p_office returning user_id
  )
  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  select 'office_changed', auth.uid(), gone.user_id, public.audit_label(gone.user_id), o.name, ''
    from gone;

  update public.offices set archived_at = now() where id = p_office;

  insert into public.audit_events (action, actor_id, subject_id, subject_label)
  values ('office_archived', auth.uid(), o.id, o.name);
end;
$$;

create or replace function public.restore_office(p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o       public.offices%rowtype;
  v_clash text;
begin
  perform public.require_office_admin();

  select * into o from public.offices where id = p_office for update;
  if o.id is null then
    raise exception 'That office no longer exists. Refresh the page.';
  end if;
  if o.archived_at is null then
    return;
  end if;

  v_clash := public.office_live_name(o.name, p_office);
  if v_clash is not null then
    raise exception 'An office named % already exists. Rename one of them first.', v_clash
      using errcode = 'unique_violation';
  end if;

  begin
    update public.offices set archived_at = null where id = p_office;
  exception when unique_violation then
    raise exception 'An office named % already exists. Rename one of them first.',
      coalesce(public.office_live_name(o.name, p_office), o.name)
      using errcode = 'unique_violation';
  end;

  insert into public.audit_events (action, actor_id, subject_id, subject_label)
  values ('office_restored', auth.uid(), o.id, o.name);
end;
$$;

/**
 * For good, and only for an archived office nobody is in. Its archived spaces' rows go
 * with it, and those spaces become unassigned; each one is logged.
 */
create or replace function public.delete_office(p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.offices%rowtype;
begin
  perform public.require_office_admin();

  select * into o from public.offices where id = p_office for update;
  if o.id is null then
    raise exception 'That office no longer exists. Refresh the page.';
  end if;
  if o.archived_at is null
     or exists (select 1 from public.office_members where office_id = p_office) then
    raise exception 'Archive this office and move its people first.'
      using errcode = 'check_violation';
  end if;

  with gone as (
    delete from public.office_spaces where office_id = p_office returning space_id
  )
  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  select 'space_office_changed', auth.uid(), gone.space_id, coalesce(s.name, ''), o.name, ''
    from gone left join public.general_spaces s on s.id = gone.space_id;

  delete from public.offices where id = p_office;

  insert into public.audit_events (action, actor_id, subject_id, subject_label)
  values ('office_deleted', auth.uid(), o.id, o.name);
end;
$$;

-- ---------------------------------------------------------------- assignments

/** A member's home office; null clears it. The row guard refuses a non-member. */
create or replace function public.set_member_office(p_user uuid, p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_before uuid;
  v_after  text := '';
begin
  perform public.require_office_admin();

  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That account no longer exists. Refresh the page.';
  end if;

  select office_id into v_before from public.office_members where user_id = p_user for update;
  if v_before is not distinct from p_office then
    return; -- already there
  end if;

  if p_office is null then
    delete from public.office_members where user_id = p_user;
  else
    select name into v_after from public.offices where id = p_office;
    if not found then
      raise exception 'That office no longer exists. Refresh the page.';
    end if;
    insert into public.office_members (user_id, office_id, assigned_by)
    values (p_user, p_office, auth.uid())
    on conflict (user_id) do update
      set office_id = excluded.office_id, assigned_by = excluded.assigned_by,
          assigned_at = now();
  end if;

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('office_changed', auth.uid(), p_user, public.audit_label(p_user),
          coalesce((select name from public.offices where id = v_before), ''), v_after);
end;
$$;

/** A work space's office; null clears it. The row guard refuses a class's space. */
create or replace function public.set_space_office(p_space uuid, p_office uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_space  text;
  v_before uuid;
  v_after  text := '';
begin
  perform public.require_office_admin();

  select name into v_space from public.general_spaces where id = p_space;
  if not found then
    raise exception 'That space no longer exists. Refresh the page.';
  end if;

  select office_id into v_before from public.office_spaces where space_id = p_space for update;
  if v_before is not distinct from p_office then
    return;
  end if;

  if p_office is null then
    delete from public.office_spaces where space_id = p_space;
  else
    select name into v_after from public.offices where id = p_office;
    if not found then
      raise exception 'That office no longer exists. Refresh the page.';
    end if;
    insert into public.office_spaces (space_id, office_id, assigned_by)
    values (p_space, p_office, auth.uid())
    on conflict (space_id) do update
      set office_id = excluded.office_id, assigned_by = excluded.assigned_by,
          assigned_at = now();
  end if;

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('space_office_changed', auth.uid(), p_space, v_space,
          coalesce((select name from public.offices where id = v_before), ''), v_after);
end;
$$;

/**
 * For a bulk import: an email and an office name. Says what happened instead of raising,
 * so one bad line does not stop the rest: 'set', 'unknown_office' (no live office by that
 * name), 'no_account' or 'not_member'.
 */
create or replace function public.set_member_office_by_name(p_email text, p_office_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_office uuid;
  v_user   uuid;
  v_role   public.user_role;
begin
  perform public.require_office_admin();

  select id into v_office from public.offices
   where archived_at is null
     and public.office_name_key(name) = public.office_name_key(p_office_name);
  if v_office is null then
    return 'unknown_office';
  end if;

  select id, role into v_user, v_role from public.profiles
   where lower(email) = lower(btrim(coalesce(p_email, '')))
   limit 1;
  if v_user is null then
    return 'no_account';
  end if;
  if v_role is distinct from 'member' then
    return 'not_member';
  end if;

  perform public.set_member_office(v_user, v_office);
  return 'set';
end;
$$;

-- ---------------------------------------------------------------- admin reads
--
-- The admin's view of the organization: names and counts, never project content. None of
-- these returns a task, comment, file, milestone title or due date, and the suite pins
-- each one's columns so nothing can be added unnoticed. The admin reads no project rows
-- through RLS, so these are definer functions that answer an active admin and return no
-- rows to anyone else.
--
-- A running project: a work project (no class board), not archived, not trashed, in a
-- work space that is not archived or trashed. Quiet: no task event made by a person (a
-- non-null actor) for 14 days, falling back to the project's own creation time, while the
-- project has a live task that is not done or no live tasks at all. Workflow rules and
-- other automation leave a null actor, so they never reset the clock.

/** The person-made events that quiet reads, newest first per project. */
create index if not exists general_task_events_person_recent
  on public.general_task_events (project_id, created_at desc)
  where actor_id is not null;

/** True for an active admin. The reads below answer nobody else. */
create or replace function public.office_admin_reads()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'admin' and status = 'active');
$$;

/** Running work projects, for the reads below only. */
create or replace function public.office_running_projects()
returns table (id uuid, name text, space_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.space_id, p.created_at
    from public.general_projects p
    join public.general_spaces s on s.id = p.space_id
   where p.class_board_id is null
     and p.archived_at is null
     and p.trashed_at is null
     and s.kind = 'work'
     and s.archived_at is null
     and s.trashed_at is null;
$$;

/** Every member account, with their home office (null for none). */
create or replace function public.admin_office_people()
returns table (id uuid, name text, email text, status text, office_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id,
         btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
         p.email,
         p.status::text,
         m.office_id
    from public.profiles p
    left join public.office_members m on m.user_id = p.id
   where public.office_admin_reads()
     and p.role = 'member'
   order by p.last_name, p.first_name, p.email;
$$;

/** Every work space not in the trash, with its office and how many projects run in it. */
create or replace function public.admin_office_spaces()
returns table (id uuid, name text, office_id uuid, archived boolean, running_projects int)
language sql stable security definer set search_path = public as $$
  select s.id,
         s.name,
         os.office_id,
         s.archived_at is not null,
         coalesce(rp.n, 0)::int
    from public.general_spaces s
    left join public.office_spaces os on os.space_id = s.id
    left join (select r.space_id, count(*) as n
                 from public.office_running_projects() r
                group by r.space_id) rp on rp.space_id = s.id
   where public.office_admin_reads()
     and s.kind = 'work'
     and s.trashed_at is null
   order by lower(s.name), s.id;
$$;

/**
 * Running projects that need the admin: no project manager (has_pm as the Work projects
 * page reads it), or quiet. quiet_since is the last person-made activity when quiet, else
 * null. No PM first, then the longest quiet.
 */
create or replace function public.admin_attention_projects()
returns table (project_id uuid, project_name text, space_name text, office_id uuid,
               office_name text, no_pm boolean, quiet_since timestamptz)
language sql stable security definer set search_path = public as $$
  with running as (
    select r.id, r.name, r.space_id, r.created_at
      from public.office_running_projects() r
     where public.office_admin_reads()
  ),
  pm as (
    select w.id, bool_or(w.has_pm) as has_pm
      from public.admin_work_project_rows() w
     group by w.id
  ),
  flagged as (
    select r.id, r.name, r.space_id,
           not coalesce(pm.has_pm, false) as no_pm,
           coalesce((select max(e.created_at) from public.general_task_events e
                      where e.project_id = r.id and e.actor_id is not null),
                    r.created_at) as last_at,
           exists (select 1 from public.general_tasks t
                    where t.project_id = r.id and t.trashed_at is null
                      and t.archived_at is null and t.status <> 'done') as open_work,
           exists (select 1 from public.general_tasks t
                    where t.project_id = r.id and t.trashed_at is null
                      and t.archived_at is null) as any_work
      from running r
      left join pm on pm.id = r.id
  ),
  marked as (
    select f.*,
           case when f.last_at < now() - interval '14 days'
                     and (f.open_work or not f.any_work)
                then f.last_at end as quiet_at
      from flagged f
  )
  select m.id, m.name, s.name, o.id, coalesce(o.name, ''), m.no_pm, m.quiet_at
    from marked m
    join public.general_spaces s on s.id = m.space_id
    left join public.office_spaces os on os.space_id = m.space_id
    left join public.offices o on o.id = os.office_id and o.archived_at is null
   where m.no_pm or m.quiet_at is not null
   order by m.no_pm desc, m.quiet_at asc nulls last, lower(m.name), m.id;
$$;

/**
 * One row per live office, then one Unassigned row (office_id null, office_name ''):
 * live work spaces, the projects running in them, active members, and how many of those
 * projects need attention. A space or person filed under an archived office counts as
 * Unassigned, so nothing drops out of the totals.
 */
create or replace function public.admin_org_overview()
returns table (office_id uuid, office_name text, spaces int, running_projects int,
               people int, needs_attention int)
language sql stable security definer set search_path = public as $$
  with buckets as (
    select o.id, o.name, 0 as ord from public.offices o where o.archived_at is null
    union all
    select null, '', 1
  ),
  live_spaces as (
    select s.id, o.id as office_id
      from public.general_spaces s
      left join public.office_spaces os on os.space_id = s.id
      left join public.offices o on o.id = os.office_id and o.archived_at is null
     where s.kind = 'work' and s.archived_at is null and s.trashed_at is null
  ),
  running as (
    select ls.office_id, count(*) as n
      from public.office_running_projects() r
      join live_spaces ls on ls.id = r.space_id
     group by ls.office_id
  ),
  people as (
    select o.id as office_id
      from public.profiles p
      left join public.office_members m on m.user_id = p.id
      left join public.offices o on o.id = m.office_id and o.archived_at is null
     where p.role = 'member' and p.status = 'active'
  ),
  attention as (
    select a.office_id from public.admin_attention_projects() a
  )
  select b.id,
         b.name,
         (select count(*) from live_spaces ls where ls.office_id is not distinct from b.id)::int,
         coalesce((select r.n from running r where r.office_id is not distinct from b.id), 0)::int,
         (select count(*) from people pp where pp.office_id is not distinct from b.id)::int,
         (select count(*) from attention a where a.office_id is not distinct from b.id)::int
    from buckets b
   where public.office_admin_reads()
   order by b.ord, lower(b.name), b.id;
$$;

/**
 * Two counts for the admin's Home: bulk-imported accounts still waiting on first-sign-in
 * setup, and privacy requests within two days of (or past) their next deadline, by the
 * Manila date rather than the database's UTC one.
 */
create or replace function public.admin_org_summary()
returns table (accounts_in_setup int, privacy_due int)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.profiles p
           where p.bulk_setup_required and p.status = 'pending')::int,
         (select count(*) from public.privacy_requests r
           where (r.status = 'open'
                  and r.acknowledge_by <= (now() at time zone 'Asia/Manila')::date + 2)
              or (r.status = 'acknowledged'
                  and r.complete_by <= (now() at time zone 'Asia/Manila')::date + 2))::int
   where public.office_admin_reads();
$$;

-- ---------------------------------------------------------------- grants

-- Internal helpers and trigger functions: nobody calls them directly.
revoke all on function public.office_name_key(text) from public, anon, authenticated;
revoke all on function public.office_live_name(text, uuid) from public, anon, authenticated;
revoke all on function public.require_office_admin() from public, anon, authenticated;
revoke all on function public.office_refuse_archived(uuid) from public, anon, authenticated;
revoke all on function public.office_members_member_only() from public, anon, authenticated;
revoke all on function public.office_spaces_work_only() from public, anon, authenticated;
revoke all on function public.general_spaces_office_default() from public, anon, authenticated;
revoke all on function public.profiles_office_role() from public, anon, authenticated;
revoke all on function public.office_admin_reads() from public, anon, authenticated;
revoke all on function public.office_running_projects() from public, anon, authenticated;

revoke all on function public.create_office(text, text) from public, anon;
revoke all on function public.rename_office(uuid, text, text) from public, anon;
revoke all on function public.archive_office(uuid) from public, anon;
revoke all on function public.restore_office(uuid) from public, anon;
revoke all on function public.delete_office(uuid) from public, anon;
revoke all on function public.set_member_office(uuid, uuid) from public, anon;
revoke all on function public.set_space_office(uuid, uuid) from public, anon;
revoke all on function public.set_member_office_by_name(text, text) from public, anon;

grant execute on function public.create_office(text, text) to authenticated;
grant execute on function public.rename_office(uuid, text, text) to authenticated;
grant execute on function public.archive_office(uuid) to authenticated;
grant execute on function public.restore_office(uuid) to authenticated;
grant execute on function public.delete_office(uuid) to authenticated;
grant execute on function public.set_member_office(uuid, uuid) to authenticated;
grant execute on function public.set_space_office(uuid, uuid) to authenticated;
grant execute on function public.set_member_office_by_name(text, text) to authenticated;

-- The admin reads. Anyone signed in may call them; only an active admin gets rows.
revoke all on function public.admin_office_people() from public, anon;
revoke all on function public.admin_office_spaces() from public, anon;
revoke all on function public.admin_org_overview() from public, anon;
revoke all on function public.admin_attention_projects() from public, anon;
revoke all on function public.admin_org_summary() from public, anon;

grant execute on function public.admin_office_people() to authenticated;
grant execute on function public.admin_office_spaces() to authenticated;
grant execute on function public.admin_org_overview() to authenticated;
grant execute on function public.admin_attention_projects() to authenticated;
grant execute on function public.admin_org_summary() to authenticated;

commit;
