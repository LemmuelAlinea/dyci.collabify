-- Collabify — the General workplace: projects anybody at the school runs.
--
--   node scripts/db.mjs supabase/general.sql
--
-- Separate tables from Education on purpose. A class project is fenced by
-- professor, class membership, syllabus weeks and approval; a General project
-- is fenced by who was invited and what their Owner let them do. Sharing tables
-- would mean every Education guard growing a second branch, so the two share
-- only accounts, notifications, conversations and storage.
--
-- Permissions, in one sentence: Owners and Managers can do everything in
-- `general_permission`; a Member can do only what an Owner granted them; and on
-- an archived project nobody can change anything until an Owner restores it.
-- `src/lib/general/permissions.ts` mirrors this. Keep them in step.
--
-- Requires supabase/workplaces.sql.

begin;

-- ---------------------------------------------------------------- types

do $$ begin
  create type public.general_level as enum ('owner', 'manager', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_permission as enum
    ('edit_project', 'manage_members', 'manage_structure', 'manage_tasks', 'edit_files');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_status as enum
    ('planning', 'in_progress', 'on_hold', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_field_type as enum
    ('short_text', 'long_text', 'number', 'money', 'date',
     'single_choice', 'multi_choice', 'yes_no', 'member', 'link');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_request_status as enum ('open', 'approved', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_invite_status as enum ('pending', 'accepted', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text not null default '',
  starts_on      date,
  ends_on        date,
  status         public.general_status not null default 'planning',
  points_enabled boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint general_projects_name_len check (char_length(btrim(name)) between 1 and 200),
  constraint general_projects_description_len check (char_length(description) <= 20000),
  constraint general_projects_dates check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

/**
 * The join code lives apart from the project row on purpose. Every member reads
 * the project; only someone who can invite should read the code, or any Member
 * could let anybody in by passing it on.
 */
create table if not exists public.general_join_codes (
  project_id uuid primary key references public.general_projects (id) on delete cascade,
  code       text not null unique,
  open       boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists general_projects_touch on public.general_projects;
create trigger general_projects_touch before update on public.general_projects
  for each row execute function public.touch_updated_at();

create table if not exists public.general_members (
  project_id uuid not null references public.general_projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  level      public.general_level not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists general_members_user_idx on public.general_members (user_id);

create table if not exists public.general_teams (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint general_teams_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_teams_id_project unique (id, project_id)
);

create unique index if not exists general_teams_name_key
  on public.general_teams (project_id, lower(btrim(name)));

-- project_id is carried on every child row so a composite key can prove the
-- team and the person belong to the same project, without a trigger.
create table if not exists public.general_team_members (
  team_id    uuid not null,
  project_id uuid not null,
  user_id    uuid not null,
  primary key (team_id, user_id),
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_positions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  -- Null covers the whole project, like "Adviser". Set, it belongs to one team.
  team_id    uuid,
  name       text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint general_positions_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_positions_id_project unique (id, project_id),
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete cascade
);

create table if not exists public.general_position_holders (
  position_id uuid not null,
  project_id  uuid not null,
  user_id     uuid not null,
  primary key (position_id, user_id),
  foreign key (position_id, project_id)
    references public.general_positions (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_grants (
  project_id uuid not null,
  user_id    uuid not null,
  permission public.general_permission not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id, permission),
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_access_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  user_id     uuid not null,
  permission  public.general_permission not null,
  reason      text not null default '',
  status      public.general_request_status not null default 'open',
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  constraint general_access_requests_reason_len check (char_length(reason) <= 1000),
  constraint general_access_requests_note_len check (char_length(note) <= 1000),
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create unique index if not exists general_access_requests_one_open
  on public.general_access_requests (project_id, user_id, permission) where status = 'open';

create table if not exists public.general_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  invitee     uuid not null references public.profiles (id) on delete cascade,
  invited_by  uuid references public.profiles (id) on delete set null,
  status      public.general_invite_status not null default 'pending',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create unique index if not exists general_invitations_one_pending
  on public.general_invitations (project_id, invitee) where status = 'pending';
create index if not exists general_invitations_invitee_idx
  on public.general_invitations (invitee, status);

create table if not exists public.general_fields (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  name       text not null,
  type       public.general_field_type not null,
  options    jsonb not null default '[]'::jsonb,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint general_fields_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_fields_options_array check (jsonb_typeof(options) = 'array')
);

create index if not exists general_fields_project_idx on public.general_fields (project_id, sort);

create table if not exists public.general_field_values (
  field_id   uuid primary key references public.general_fields (id) on delete cascade,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

/** A deactivated account is a member of nothing, whatever rows still exist. */
create or replace function public.is_general_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;

create or replace function public.is_general_owner(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = auth.uid() and m.level = 'owner'
  );
$$;

create or replace function public.general_is_archived(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.general_projects where id = p_project),
    false
  );
$$;

/** Holds the permission, archived or not. For deciding what somebody may read. */
create or replace function public.general_has(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and (
    exists (
      select 1 from public.general_members m
       where m.project_id = p_project and m.user_id = auth.uid()
         and m.level in ('owner', 'manager')
    )
    or exists (
      select 1 from public.general_grants g
       where g.project_id = p_project and g.user_id = auth.uid()
         and g.permission = p_permission
    )
  );
$$;

/** May use the permission now. False for everybody on an archived project. */
create or replace function public.general_can(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select not public.general_is_archived(p_project)
     and public.general_has(p_project, p_permission);
$$;

/** Whether the caller is a signed-in, active account. Deactivated accounts read nothing. */
create or replace function public.general_viewer_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status <> 'rejected'
  );
$$;

/**
 * Whether the viewer may see this person's profile because of a General
 * project. Peers are only people who share an actual membership — a pending
 * invitation does not qualify, or inviting somebody would let every member of
 * the project read that invitee's whole profile (email included).
 */
create or replace function public.shares_general_project_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_viewer_active() and exists (
    select 1
      from public.general_members mine
      join public.general_members theirs on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

create or replace function public.general_permission_label(p public.general_permission)
returns text language sql immutable as $$
  select case p
    when 'edit_project' then 'Edit project details'
    when 'manage_members' then 'Invite and remove members'
    when 'manage_structure' then 'Manage teams and positions'
    when 'manage_tasks' then 'Manage all tasks'
    when 'edit_files' then 'Edit files on any task'
  end;
$$;

create or replace function public.general_field_project(p_field uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.general_fields where id = p_field;
$$;

-- ---------------------------------------------------------------- guards

/**
 * Archiving changes only through the Owner's RPC, which raises a
 * transaction-local flag. Everything else on the row is `edit_project`, which
 * the update policy already checks.
 */
create or replace function public.guard_general_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if current_setting('collabify.general_owner_op', true) is distinct from 'on'
     and new.archived_at is distinct from old.archived_at then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  if old.archived_at is not null and new.archived_at is not null then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_projects_guard on public.general_projects;
create trigger general_projects_guard before update on public.general_projects
  for each row execute function public.guard_general_project();

/** Null when the options suit the type, otherwise why they do not. Mirrors checkOptions(). */
create or replace function public.general_options_problem(
  p_type public.general_field_type,
  p_options jsonb
) returns text language plpgsql immutable as $$
declare
  n int := jsonb_array_length(p_options);
begin
  if p_type not in ('single_choice', 'multi_choice') then
    return case when n = 0 then null else 'Only choice fields have options' end;
  end if;
  if n = 0 then return 'Add at least one option'; end if;
  if n > 50 then return 'Keep it to 50 options'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_options) e
     where jsonb_typeof(e) <> 'string'
        or char_length(btrim(e #>> '{}')) not between 1 and 80
  ) then
    return 'Each option needs 1 to 80 characters';
  end if;
  if (select count(distinct lower(btrim(e))) from jsonb_array_elements_text(p_options) e) <> n then
    return 'An option is listed twice';
  end if;
  return null;
end;
$$;

create or replace function public.guard_general_field()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  problem text;
begin
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;

    if new.type is distinct from old.type
       and exists (select 1 from public.general_field_values v where v.field_id = old.id) then
      raise exception 'This field already holds a value, so its type cannot change. Add a new field instead.'
        using errcode = 'check_violation';
    end if;

    if new.type in ('single_choice', 'multi_choice') and exists (
      select 1
        from public.general_field_values v,
             jsonb_array_elements_text(
               case when jsonb_typeof(v.value) = 'array' then v.value
                    else jsonb_build_array(v.value) end
             ) as chosen(opt)
       where v.field_id = old.id
         and not (new.options ? chosen.opt)
    ) then
      raise exception 'An option you removed is still chosen. Change that value first.'
        using errcode = 'check_violation';
    end if;
  end if;

  if public.general_is_archived(new.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  new.name := btrim(new.name);
  problem := public.general_options_problem(new.type, new.options);
  if problem is not null then
    raise exception '%', problem using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_fields_guard on public.general_fields;
create trigger general_fields_guard before insert or update on public.general_fields
  for each row execute function public.guard_general_field();

/** Mirrors checkFieldValue() in src/lib/general/fields.ts. */
create or replace function public.guard_general_field_value()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f public.general_fields%rowtype;
  kind text := jsonb_typeof(new.value);
  txt text := new.value #>> '{}';
  n numeric;
  d date;
begin
  select * into f from public.general_fields where id = new.field_id;
  if f.id is null then
    raise exception 'That field no longer exists';
  end if;

  case f.type
    when 'short_text' then
      if kind <> 'string' or char_length(btrim(txt)) not between 1 and 200 then
        raise exception 'Short text needs 1 to 200 characters' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
    when 'long_text' then
      if kind <> 'string' or char_length(btrim(txt)) not between 1 and 10000 then
        raise exception 'Long text needs 1 to 10,000 characters' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
    when 'number' then
      if kind <> 'number' then
        raise exception 'Enter a number' using errcode = 'check_violation';
      end if;
      if abs(txt::numeric) > 1e12 then
        raise exception 'Enter a number' using errcode = 'check_violation';
      end if;
    when 'money' then
      if kind <> 'number' then
        raise exception 'Enter an amount' using errcode = 'check_violation';
      end if;
      n := txt::numeric;
      if n < 0 or n > 1e12 or n <> round(n, 2) then
        raise exception 'An amount is zero or more, with at most two decimal places'
          using errcode = 'check_violation';
      end if;
    when 'date' then
      if kind <> 'string' or txt !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Pick a date' using errcode = 'check_violation';
      end if;
      begin
        d := txt::date;
      exception when others then
        raise exception 'Pick a real date' using errcode = 'check_violation';
      end;
      if to_char(d, 'YYYY-MM-DD') <> txt then
        raise exception 'Pick a real date' using errcode = 'check_violation';
      end if;
    when 'single_choice' then
      if kind <> 'string' or not (f.options ? txt) then
        raise exception 'Pick one of the options' using errcode = 'check_violation';
      end if;
    when 'multi_choice' then
      if kind <> 'array' or jsonb_array_length(new.value) = 0
         or exists (
           select 1 from jsonb_array_elements(new.value) e
            where jsonb_typeof(e) <> 'string' or not (f.options ? (e #>> '{}'))
         )
         or (select count(distinct e) from jsonb_array_elements_text(new.value) e)
            <> jsonb_array_length(new.value) then
        raise exception 'Pick options from the list, each once' using errcode = 'check_violation';
      end if;
    when 'yes_no' then
      if kind <> 'boolean' then
        raise exception 'Choose yes or no' using errcode = 'check_violation';
      end if;
    when 'member' then
      if kind <> 'string' or not exists (
        select 1 from public.general_members m
         where m.project_id = f.project_id and m.user_id::text = txt
      ) then
        raise exception 'Pick somebody on this project' using errcode = 'check_violation';
      end if;
    when 'link' then
      if kind <> 'string' or char_length(btrim(txt)) > 2000 or btrim(txt) !~* '^https?://\S+$' then
        raise exception 'Start the address with http:// or https://' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
  end case;

  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists general_field_values_guard on public.general_field_values;
create trigger general_field_values_guard before insert or update on public.general_field_values
  for each row execute function public.guard_general_field_value();

/** Teams and positions are frozen with the project too. */
create or replace function public.guard_general_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is not null and public.general_is_archived(p) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_teams_guard on public.general_teams;
create trigger general_teams_guard before insert or update or delete on public.general_teams
  for each row execute function public.guard_general_structure();
drop trigger if exists general_positions_guard on public.general_positions;
create trigger general_positions_guard before insert or update or delete on public.general_positions
  for each row execute function public.guard_general_structure();

-- ---------------------------------------------------------------- row-level security

alter table public.general_projects         enable row level security;
alter table public.general_join_codes       enable row level security;
alter table public.general_members          enable row level security;
alter table public.general_teams            enable row level security;
alter table public.general_team_members     enable row level security;
alter table public.general_positions        enable row level security;
alter table public.general_position_holders enable row level security;
alter table public.general_grants           enable row level security;
alter table public.general_access_requests  enable row level security;
alter table public.general_invitations      enable row level security;
alter table public.general_fields           enable row level security;
alter table public.general_field_values     enable row level security;

drop policy if exists general_projects_select on public.general_projects;
create policy general_projects_select on public.general_projects
  for select using (
    public.is_general_member(id)
    or (
      public.general_viewer_active()
      and exists (
        select 1 from public.general_invitations i
         where i.project_id = general_projects.id
           and i.invitee = auth.uid() and i.status = 'pending'
      )
    )
  );

-- `general_has`, not `general_can`: on an archived project the row must reach
-- guard_general_project so the editor is told why, rather than the update
-- silently matching nothing.
drop policy if exists general_projects_update on public.general_projects;
create policy general_projects_update on public.general_projects
  for update using (public.general_has(id, 'edit_project'))
  with check (public.general_has(id, 'edit_project'));

-- No write policy: the code changes only through set_general_join_code.
drop policy if exists general_join_codes_select on public.general_join_codes;
create policy general_join_codes_select on public.general_join_codes
  for select using (public.general_has(project_id, 'manage_members'));

drop policy if exists general_members_select on public.general_members;
create policy general_members_select on public.general_members
  for select using (public.is_general_member(project_id));

-- Teams, positions and the people in them.
do $$
declare
  t text;
begin
  foreach t in array array['general_teams', 'general_team_members',
                           'general_positions', 'general_position_holders'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_general_member(project_id))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all using (public.general_can(project_id, %L))
         with check (public.general_can(project_id, %L))',
      t || '_write', t, 'manage_structure', 'manage_structure');
  end loop;
end $$;

drop policy if exists general_grants_select on public.general_grants;
create policy general_grants_select on public.general_grants
  for select using (public.is_general_member(project_id));

drop policy if exists general_access_requests_select on public.general_access_requests;
create policy general_access_requests_select on public.general_access_requests
  for select using (
    (user_id = auth.uid() and public.general_viewer_active())
    or public.is_general_owner(project_id)
  );

drop policy if exists general_invitations_select on public.general_invitations;
create policy general_invitations_select on public.general_invitations
  for select using (
    (invitee = auth.uid() and public.general_viewer_active())
    or public.general_has(project_id, 'manage_members')
  );

drop policy if exists general_fields_select on public.general_fields;
create policy general_fields_select on public.general_fields
  for select using (public.is_general_member(project_id));

drop policy if exists general_fields_write on public.general_fields;
create policy general_fields_write on public.general_fields
  for all using (public.general_can(project_id, 'edit_project'))
  with check (public.general_can(project_id, 'edit_project'));

drop policy if exists general_field_values_select on public.general_field_values;
create policy general_field_values_select on public.general_field_values
  for select using (public.is_general_member(public.general_field_project(field_id)));

drop policy if exists general_field_values_write on public.general_field_values;
create policy general_field_values_write on public.general_field_values
  for all using (public.general_can(public.general_field_project(field_id), 'edit_project'))
  with check (public.general_can(public.general_field_project(field_id), 'edit_project'));

-- Profiles of the people you work with in General.
drop policy if exists profiles_select_general_peer on public.profiles;
create policy profiles_select_general_peer on public.profiles
  for select using (public.shares_general_project_with(id));

-- ---------------------------------------------------------------- RPCs: projects

create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null
) returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  insert into public.general_projects (name, description, starts_on, ends_on, created_by)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid())
  returning * into p;

  insert into public.general_members (project_id, user_id, level)
  values (p.id, auth.uid(), 'owner');

  return p;
end;
$$;

create or replace function public.archive_general_project(p_project uuid, p_archived boolean)
returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_owner_op', 'on', true);
  update public.general_projects
     set archived_at = case when p_archived then now() else null end
   where id = p_project
  returning * into p;
  perform set_config('collabify.general_owner_op', 'off', true);

  -- Archiving closes the door too; restoring leaves it closed.
  if p_archived then
    update public.general_join_codes set open = false, updated_at = now()
     where project_id = p_project;
  end if;

  return p;
end;
$$;

-- ---------------------------------------------------------------- RPCs: people

/**
 * Finding somebody to invite, without handing out the school's address book.
 *
 * A name search returns names and photos only. The email comes back only when
 * the query *is* that email — the person searching already has it. Three
 * characters minimum and a rate limit keep it from being walked.
 */
create or replace function public.search_general_people(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if char_length(q) < 3 then
    return;
  end if;

  perform public.rate_limit('general_people_search', 60, interval '1 minute',
    'Too many searches at once. Wait a minute and try again.');

  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select pr.id, pr.first_name, pr.last_name, pr.avatar_url,
           case when lower(pr.email) = lower(q) then pr.email end
      from public.profiles pr
     where pr.status <> 'rejected'
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

create or replace function public.invite_to_general_project(p_project uuid, p_user uuid)
returns public.general_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to invite people to this project'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_members where project_id = p_project and user_id = p_user) then
    raise exception 'They are already on this project' using errcode = 'unique_violation';
  end if;

  select * into inv from public.general_invitations
   where project_id = p_project and invitee = p_user and status = 'pending';
  if inv.id is not null then
    return inv; -- already invited, and inviting again is not an error
  end if;

  perform public.rate_limit('general_invite', 100, interval '1 hour',
    'You have sent a lot of invitations in the last hour. Try again later.');

  insert into public.general_invitations (project_id, invitee, invited_by)
  values (p_project, p_user, auth.uid())
  returning * into inv;
  return inv;
end;
$$;

create or replace function public.withdraw_general_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  select * into inv from public.general_invitations where id = p_invitation for update;
  if inv.id is null or not public.general_can(inv.project_id, 'manage_members') then
    raise exception 'You cannot withdraw that invitation' using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered' using errcode = 'check_violation';
  end if;
  update public.general_invitations
     set status = 'withdrawn', answered_at = now()
   where id = p_invitation;
end;
$$;

create or replace function public.respond_general_invitation(p_invitation uuid, p_accept boolean)
returns public.general_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to answer an invitation'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.general_invitations where id = p_invitation for update;
  if inv.id is null or inv.invitee is distinct from auth.uid() then
    raise exception 'That invitation is not yours to answer' using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered or withdrawn' using errcode = 'check_violation';
  end if;
  if p_accept and public.general_is_archived(inv.project_id) then
    raise exception 'That project is archived, so it cannot take new members'
      using errcode = 'check_violation';
  end if;

  update public.general_invitations
     set status = case when p_accept then 'accepted' else 'declined' end::public.general_invite_status,
         answered_at = now()
   where id = p_invitation
  returning * into inv;

  if p_accept then
    insert into public.general_members (project_id, user_id)
    values (inv.project_id, auth.uid())
    on conflict do nothing;
  end if;
  return inv;
end;
$$;

/**
 * Pending invitations sent to the caller, with just enough about the project
 * and the inviter to show a card — never the inviter's or the caller's own
 * profile row. Returns nothing for a deactivated caller.
 */
create or replace function public.list_my_general_invitations()
returns table (
  invitation_id       uuid,
  project_id          uuid,
  project_name        text,
  project_description text,
  inviter_id          uuid,
  inviter_first_name  text,
  inviter_last_name   text,
  inviter_avatar_url  text,
  created_at          timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.general_viewer_active() then
    return;
  end if;

  return query
    select i.id, i.project_id, gp.name, gp.description,
           i.invited_by, pr.first_name, pr.last_name, pr.avatar_url, i.created_at
      from public.general_invitations i
      join public.general_projects gp on gp.id = i.project_id
      left join public.profiles pr on pr.id = i.invited_by
     where i.invitee = auth.uid() and i.status = 'pending'
     order by i.created_at desc;
end;
$$;

/**
 * Pending invitations sent out by a project, with just enough about each
 * invitee to show who they are — never their email. Only somebody who can
 * invite may see who else was invited.
 */
create or replace function public.list_general_project_invitations(p_project uuid)
returns table (
  invitation_id       uuid,
  invitee_id          uuid,
  invitee_first_name  text,
  invitee_last_name   text,
  invitee_avatar_url  text,
  invited_by          uuid,
  created_at          timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.general_has(p_project, 'manage_members') then
    raise exception 'You need permission to see this project''s invitations'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.invitee, pr.first_name, pr.last_name, pr.avatar_url,
           i.invited_by, i.created_at
      from public.general_invitations i
      join public.profiles pr on pr.id = i.invitee
     where i.project_id = p_project and i.status = 'pending'
     order by i.created_at desc;
end;
$$;

create or replace function public.set_general_join_code(
  p_project    uuid,
  p_open       boolean,
  p_regenerate boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare
  -- No 0/O, 1/I/L: a code gets read aloud across a room.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  raw bytea;
  i int;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner changes the join code' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select jc.code into v_code from public.general_join_codes jc
   where jc.project_id = p_project for update;
  if p_open and (v_code is null or p_regenerate) then
    loop
      raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      v_code := '';
      -- Bytes 6 and 8 carry the uuid version and variant bits; skip them.
      foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
        v_code := v_code || substr(alphabet, 1 + get_byte(raw, i) % 31, 1);
      end loop;
      exit when not exists (select 1 from public.general_join_codes jc where jc.code = v_code);
    end loop;
  end if;

  if v_code is null then
    return null; -- closing a code that was never opened
  end if;

  insert into public.general_join_codes (project_id, code, open)
  values (p_project, v_code, p_open)
  on conflict (project_id) do update
    set code = excluded.code, open = excluded.open, updated_at = now();

  return v_code;
end;
$$;

/**
 * A wrong or expired code returns null rather than raising, so the rate-limit
 * count taken above it is not rolled back by the failure — a miss still costs
 * an attempt. The caller being deactivated or over the rate limit still
 * raises: those are refusals, not misses.
 */
create or replace function public.join_general_project(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a project'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  perform public.rate_limit('general_join', 10, interval '10 minutes',
    'Too many join attempts. Wait a few minutes and try again.');

  select pr.* into p
    from public.general_join_codes jc
    join public.general_projects pr on pr.id = jc.project_id
   where jc.code = upper(btrim(p_code)) and jc.open and pr.archived_at is null;
  if p.id is null then
    return null; -- a miss, not a refusal; the rate-limit count already committed
  end if;

  insert into public.general_members (project_id, user_id)
  values (p.id, auth.uid())
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$$;

-- ---------------------------------------------------------------- RPCs: levels and membership

create or replace function public.set_general_member_level(
  p_project uuid,
  p_user    uuid,
  p_level   public.general_level
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
  owners int;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner changes access levels' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- Every Owner row locked before counting, so two Owners stepping down at
  -- once cannot both see the other still there.
  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;

  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;

  -- Stepping down a deactivated Owner never changes how many active Owners
  -- there are, so it is never blocked by this check — only demoting somebody
  -- who is still active can leave the project with zero of them.
  if target.level = 'owner' and p_level <> 'owner'
     and exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    select count(*) into owners
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project and m.level = 'owner' and pr.status <> 'rejected';
    if owners <= 1 then
      raise exception 'A project needs at least one Owner. Make someone else an Owner first.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.general_members set level = p_level
   where project_id = p_project and user_id = p_user;

  -- A Manager or Owner already holds every permission, so the extras and any
  -- open requests for them are moot.
  if p_level <> 'member' then
    delete from public.general_grants where project_id = p_project and user_id = p_user;
    update public.general_access_requests
       set status = 'withdrawn', answered_at = now()
     where project_id = p_project and user_id = p_user and status = 'open';
  end if;
end;
$$;

create or replace function public.remove_general_member(p_project uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
  owners int;
begin
  if p_user = auth.uid() then
    raise exception 'Use Leave project to remove yourself' using errcode = 'check_violation';
  end if;
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to remove people from this project'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;
  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;

  if target.level in ('owner', 'manager') and not public.is_general_owner(p_project) then
    raise exception 'Only an Owner removes an Owner or a Manager'
      using errcode = 'insufficient_privilege';
  end if;
  -- Removing a deactivated Owner never changes how many active Owners there
  -- are, so it is never blocked by this check.
  if target.level = 'owner'
     and exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    select count(*) into owners
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project and m.level = 'owner' and pr.status <> 'rejected';
    if owners <= 1 then
      raise exception 'A project needs at least one Owner' using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_members where project_id = p_project and user_id = p_user;
end;
$$;

create or replace function public.leave_general_project(p_project uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.general_members%rowtype;
  owners int;
begin
  -- Same lock order as set_general_member_level and remove_general_member: a
  -- lock-free existence check first, then every Owner row, then the caller's
  -- own row — so two people leaving the same project at once cannot deadlock
  -- on each other's locks.
  if not exists (
    select 1 from public.general_members where project_id = p_project and user_id = auth.uid()
  ) then
    raise exception 'You are not on this project' using errcode = 'no_data_found';
  end if;

  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;

  select * into me from public.general_members
   where project_id = p_project and user_id = auth.uid() for update;
  if me.user_id is null then
    raise exception 'You are not on this project' using errcode = 'no_data_found';
  end if;

  if me.level = 'owner' then
    select count(*) into owners
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project and m.level = 'owner' and pr.status <> 'rejected';
    if owners <= 1 then
      raise exception 'You are the last Owner. Make someone else an Owner before you leave.'
        using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_members where project_id = p_project and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------- RPCs: extra permissions

create or replace function public.grant_general_permission(
  p_project    uuid,
  p_user       uuid,
  p_permission public.general_permission
) returns void
language plpgsql security definer set search_path = public as $$
declare
  lvl public.general_level;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner grants permissions' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level into lvl from public.general_members
   where project_id = p_project and user_id = p_user;
  if lvl is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;
  if lvl <> 'member' then
    raise exception 'Owners and Managers already hold every permission'
      using errcode = 'check_violation';
  end if;

  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (p_project, p_user, p_permission, auth.uid())
  on conflict do nothing;

  -- Granting what somebody asked for answers their request.
  update public.general_access_requests
     set status = 'approved', answered_by = auth.uid(), answered_at = now()
   where project_id = p_project and user_id = p_user
     and permission = p_permission and status = 'open';
end;
$$;

create or replace function public.revoke_general_permission(
  p_project    uuid,
  p_user       uuid,
  p_permission public.general_permission
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner takes permissions back' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  delete from public.general_grants
   where project_id = p_project and user_id = p_user and permission = p_permission;
end;
$$;

create or replace function public.request_general_access(
  p_project    uuid,
  p_permission public.general_permission,
  p_reason     text default ''
) returns public.general_access_requests
language plpgsql security definer set search_path = public as $$
declare
  lvl public.general_level;
  req public.general_access_requests%rowtype;
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level into lvl from public.general_members
   where project_id = p_project and user_id = auth.uid();
  if lvl <> 'member' or exists (
    select 1 from public.general_grants
     where project_id = p_project and user_id = auth.uid() and permission = p_permission
  ) then
    raise exception 'You already have that permission' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.general_access_requests
     where project_id = p_project and user_id = auth.uid()
       and permission = p_permission and status = 'open'
  ) then
    raise exception 'You already asked for this. An Owner has not answered yet.'
      using errcode = 'unique_violation';
  end if;

  perform public.rate_limit('general_access_request', 20, interval '1 hour',
    'You have sent a lot of access requests in the last hour. Try again later.');

  insert into public.general_access_requests (project_id, user_id, permission, reason)
  values (p_project, auth.uid(), p_permission, btrim(coalesce(p_reason, '')))
  returning * into req;
  return req;
end;
$$;

create or replace function public.answer_general_access_request(
  p_request uuid,
  p_approve boolean,
  p_note    text default ''
) returns public.general_access_requests
language plpgsql security definer set search_path = public as $$
declare
  req public.general_access_requests%rowtype;
  lvl public.general_level;
begin
  select * into req from public.general_access_requests where id = p_request for update;
  if req.id is null or not public.is_general_owner(req.project_id) then
    raise exception 'Only an Owner answers access requests' using errcode = 'insufficient_privilege';
  end if;
  if req.status <> 'open' then
    raise exception 'That request was already answered' using errcode = 'check_violation';
  end if;
  if public.general_is_archived(req.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_access_requests
     set status = case when p_approve then 'approved' else 'declined' end::public.general_request_status,
         answered_by = auth.uid(),
         answered_at = now(),
         note = btrim(coalesce(p_note, ''))
   where id = p_request
  returning * into req;

  if p_approve then
    select level into lvl from public.general_members
     where project_id = req.project_id and user_id = req.user_id;
    if lvl = 'member' then
      insert into public.general_grants (project_id, user_id, permission, granted_by)
      values (req.project_id, req.user_id, req.permission, auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return req;
end;
$$;

create or replace function public.withdraw_general_access_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  req public.general_access_requests%rowtype;
begin
  select * into req from public.general_access_requests where id = p_request for update;
  if req.id is null or req.user_id is distinct from auth.uid() then
    raise exception 'That request is not yours to withdraw' using errcode = 'insufficient_privilege';
  end if;
  if req.status <> 'open' then
    raise exception 'That request was already answered' using errcode = 'check_violation';
  end if;
  update public.general_access_requests
     set status = 'withdrawn', answered_at = now()
   where id = p_request;
end;
$$;

-- ---------------------------------------------------------------- grants

grant execute on function public.create_general_project(text, text, date, date) to authenticated;
grant execute on function public.archive_general_project(uuid, boolean) to authenticated;
grant execute on function public.search_general_people(text) to authenticated;
grant execute on function public.invite_to_general_project(uuid, uuid) to authenticated;
grant execute on function public.withdraw_general_invitation(uuid) to authenticated;
grant execute on function public.respond_general_invitation(uuid, boolean) to authenticated;
grant execute on function public.list_my_general_invitations() to authenticated;
grant execute on function public.list_general_project_invitations(uuid) to authenticated;
grant execute on function public.set_general_join_code(uuid, boolean, boolean) to authenticated;
grant execute on function public.join_general_project(text) to authenticated;
grant execute on function public.set_general_member_level(uuid, uuid, public.general_level) to authenticated;
grant execute on function public.remove_general_member(uuid, uuid) to authenticated;
grant execute on function public.leave_general_project(uuid) to authenticated;
grant execute on function public.grant_general_permission(uuid, uuid, public.general_permission) to authenticated;
grant execute on function public.revoke_general_permission(uuid, uuid, public.general_permission) to authenticated;
grant execute on function public.request_general_access(uuid, public.general_permission, text) to authenticated;
grant execute on function public.answer_general_access_request(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_general_access_request(uuid) to authenticated;

grant select, update on public.general_projects to authenticated;
grant select on public.general_join_codes, public.general_members, public.general_grants,
                public.general_access_requests, public.general_invitations to authenticated;
grant select, insert, update, delete on public.general_teams, public.general_team_members,
                public.general_positions, public.general_position_holders,
                public.general_fields, public.general_field_values to authenticated;

-- ---------------------------------------------------------------- realtime

do $$
declare
  t text;
begin
  foreach t in array array['general_projects', 'general_join_codes', 'general_members', 'general_teams',
                           'general_team_members', 'general_positions',
                           'general_position_holders', 'general_grants',
                           'general_access_requests', 'general_invitations',
                           'general_fields', 'general_field_values'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
