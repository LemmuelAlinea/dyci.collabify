-- Space-scoped reusable teams for the General workplace.
--
-- Project teams already exist and remain project-local. A space team is a
-- reusable template/group inside one space; choosing it while creating a
-- project seeds that project's membership and creates the matching project
-- team without widening project write permissions.

begin;

create table if not exists public.general_space_teams (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.general_spaces (id) on delete cascade,
  name        text not null,
  description text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_space_teams_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_space_teams_description_len check (char_length(description) <= 500),
  constraint general_space_teams_id_space unique (id, space_id)
);

drop trigger if exists general_space_teams_touch on public.general_space_teams;
create trigger general_space_teams_touch before update on public.general_space_teams
  for each row execute function public.touch_updated_at();

create unique index if not exists general_space_teams_name_key
  on public.general_space_teams (space_id, lower(btrim(name)));
create index if not exists general_space_teams_space_idx
  on public.general_space_teams (space_id, name);

alter table public.general_space_teams
  add column if not exists archived_at timestamptz;

create index if not exists general_space_teams_archive_idx
  on public.general_space_teams (space_id, archived_at);

create table if not exists public.general_space_team_members (
  team_id   uuid not null,
  space_id  uuid not null,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  level     public.general_level not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (team_id, space_id)
    references public.general_space_teams (id, space_id) on delete cascade,
  foreign key (space_id, user_id)
    references public.general_space_members (space_id, user_id) on delete cascade
);

create index if not exists general_space_team_members_user_idx
  on public.general_space_team_members (user_id);
create index if not exists general_space_team_members_space_idx
  on public.general_space_team_members (space_id, team_id);

alter table public.general_teams
  add column if not exists space_team_id uuid references public.general_space_teams (id) on delete set null;

create index if not exists general_teams_space_team_idx
  on public.general_teams (space_team_id) where space_team_id is not null;
create unique index if not exists general_teams_one_space_team_per_project
  on public.general_teams (project_id, space_team_id) where space_team_id is not null;

create or replace function public.is_general_space_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_space_team_members tm
      join public.profiles pr on pr.id = tm.user_id
     where tm.team_id = p_team
       and tm.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;

create or replace function public.general_space_team_can_manage(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_space_team_members tm
      join public.general_space_teams t on t.id = tm.team_id
     where tm.team_id = p_team
       and tm.user_id = auth.uid()
       and tm.level in ('owner', 'manager')
       and not public.general_space_is_archived(t.space_id)
  );
$$;

create or replace function public.general_space_team_can_use(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_space_team_member(p_team) and exists (
    select 1 from public.general_space_teams t
     where t.id = p_team
       and t.archived_at is null
       and not public.general_space_is_archived(t.space_id)
  );
$$;

alter table public.general_space_teams enable row level security;
alter table public.general_space_team_members enable row level security;

drop policy if exists general_space_teams_select on public.general_space_teams;
create policy general_space_teams_select on public.general_space_teams
  for select using (
    public.is_general_space_team_member(id)
    or public.general_space_has_invite(space_id)
  );

drop policy if exists general_space_team_members_select on public.general_space_team_members;
create policy general_space_team_members_select on public.general_space_team_members
  for select using (
    public.is_general_space_team_member(team_id)
    or public.general_space_has_invite(space_id)
  );

revoke all on public.general_space_teams, public.general_space_team_members from public, anon;
grant select on public.general_space_teams, public.general_space_team_members to authenticated;

drop function if exists public.list_general_space_teams(uuid);

create or replace function public.list_general_space_teams(p_space uuid)
returns table (
  id           uuid,
  space_id     uuid,
  name         text,
  description  text,
  created_by   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  archived_at  timestamptz,
  my_level     public.general_level,
  member_count int,
  project_count int
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select t.id, t.space_id, t.name, t.description, t.created_by, t.created_at, t.updated_at,
           t.archived_at,
           mine.level as my_level,
           (select count(*) from public.general_space_team_members m where m.team_id = t.id)::int,
           (select count(distinct gt.project_id) from public.general_teams gt where gt.space_team_id = t.id)::int
      from public.general_space_teams t
      join public.general_space_team_members mine
        on mine.team_id = t.id and mine.user_id = auth.uid()
     where t.space_id = p_space
     order by t.name;
end;
$$;

create or replace function public.list_general_space_teams(p_space uuid, p_archived boolean)
returns table (
  id           uuid,
  space_id     uuid,
  name         text,
  description  text,
  created_by   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  archived_at  timestamptz,
  my_level     public.general_level,
  member_count int,
  project_count int
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select t.id, t.space_id, t.name, t.description, t.created_by, t.created_at, t.updated_at,
           t.archived_at,
           mine.level as my_level,
           (select count(*) from public.general_space_team_members m where m.team_id = t.id)::int,
           (select count(distinct gt.project_id) from public.general_teams gt where gt.space_team_id = t.id)::int
      from public.general_space_teams t
      join public.general_space_team_members mine
        on mine.team_id = t.id and mine.user_id = auth.uid()
     where t.space_id = p_space
       and ((p_archived and t.archived_at is not null)
            or (not p_archived and t.archived_at is null))
     order by t.name;
end;
$$;

create or replace function public.list_general_space_team_members(p_space uuid)
returns table (
  team_id    uuid,
  user_id    uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  level      public.general_level,
  joined_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select tm.team_id, tm.user_id, pr.first_name, pr.last_name, pr.avatar_url,
           tm.level, tm.joined_at
      from public.general_space_team_members tm
      join public.general_space_teams t on t.id = tm.team_id
      join public.profiles pr on pr.id = tm.user_id
     where tm.space_id = p_space
       and exists (
         select 1 from public.general_space_team_members mine
          where mine.team_id = tm.team_id and mine.user_id = auth.uid()
       )
     order by t.name, tm.level, pr.last_name, pr.first_name;
end;
$$;

create or replace function public.create_general_space_team(
  p_space       uuid,
  p_name        text,
  p_description text default '',
  p_members     uuid[] default '{}'::uuid[]
) returns public.general_space_teams
language plpgsql security definer set search_path = public as $$
declare
  t public.general_space_teams%rowtype;
  u uuid;
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in that space' using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'That space is archived' using errcode = 'check_violation';
  end if;

  insert into public.general_space_teams (space_id, name, description, created_by)
  values (p_space, btrim(p_name), coalesce(p_description, ''), auth.uid())
  returning * into t;

  insert into public.general_space_team_members (team_id, space_id, user_id, level)
  values (t.id, p_space, auth.uid(), 'owner')
  on conflict (team_id, user_id) do update set level = 'owner';

  foreach u in array coalesce(p_members, '{}'::uuid[]) loop
    if u <> auth.uid() then
      insert into public.general_space_team_members (team_id, space_id, user_id, level)
      select t.id, p_space, u, 'member'
       where exists (
         select 1 from public.general_space_members sm
          where sm.space_id = p_space and sm.user_id = u
       )
      on conflict (team_id, user_id) do nothing;
    end if;
  end loop;

  return t;
end;
$$;

create or replace function public.update_general_space_team(
  p_team        uuid,
  p_name        text,
  p_description text default ''
) returns public.general_space_teams
language plpgsql security definer set search_path = public as $$
declare
  t public.general_space_teams%rowtype;
begin
  if not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;

  update public.general_space_teams
     set name = btrim(p_name), description = coalesce(p_description, '')
   where id = p_team and archived_at is null
  returning * into t;

  if not found then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  return t;
end;
$$;

create or replace function public.archive_general_space_team(p_team uuid, p_archived boolean)
returns public.general_space_teams
language plpgsql security definer set search_path = public as $$
declare
  t public.general_space_teams%rowtype;
begin
  if not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;

  update public.general_space_teams
     set archived_at = case when p_archived then now() else null end
   where id = p_team
  returning * into t;

  return t;
end;
$$;

create or replace function public.delete_general_space_team(p_team uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;

  delete from public.general_space_teams where id = p_team;
end;
$$;

create or replace function public.add_general_space_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.general_space_teams%rowtype;
begin
  select * into t from public.general_space_teams where id = p_team;
  if not found then
    raise exception 'That team is gone' using errcode = 'no_data_found';
  end if;
  if not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;
  if t.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  insert into public.general_space_team_members (team_id, space_id, user_id, level)
  select p_team, t.space_id, p_user, 'member'
   where exists (
     select 1 from public.general_space_members sm
      where sm.space_id = t.space_id and sm.user_id = p_user
   )
  on conflict (team_id, user_id) do nothing;
end;
$$;

create or replace function public.remove_general_space_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_space_team_members%rowtype;
  owners int;
begin
  select * into target
    from public.general_space_team_members
   where team_id = p_team and user_id = p_user;
  if not found then
    return;
  end if;

  if p_user <> auth.uid() and not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.general_space_teams where id = p_team and archived_at is not null) then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  if target.level = 'owner' then
    select count(*) into owners
      from public.general_space_team_members
     where team_id = p_team and level = 'owner' and user_id <> p_user;
    if owners = 0 then
      raise exception 'A team needs at least one Owner' using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_space_team_members
   where team_id = p_team and user_id = p_user;
end;
$$;

create or replace function public.set_general_space_team_level(
  p_team uuid,
  p_user uuid,
  p_level public.general_level
) returns void
language plpgsql security definer set search_path = public as $$
declare
  owners int;
begin
  if not public.general_space_team_can_manage(p_team) then
    raise exception 'You cannot manage that team' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.general_space_teams where id = p_team and archived_at is not null) then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  if p_level <> 'owner' then
    select count(*) into owners
      from public.general_space_team_members
     where team_id = p_team and level = 'owner' and user_id <> p_user;
    if owners = 0 then
      raise exception 'A team needs at least one Owner' using errcode = 'check_violation';
    end if;
  end if;

  update public.general_space_team_members
     set level = p_level
   where team_id = p_team and user_id = p_user;
end;
$$;

drop function if exists public.create_general_project(text, text, date, date, text, jsonb, uuid);

create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null,
  p_preset      text default null,
  p_content     jsonb default null,
  p_space       uuid default null,
  p_space_team  uuid default null
) returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p          public.general_projects%rowtype;
  item       jsonb;
  team_name  text;
  team_ids   jsonb := '{}'::jsonb;
  n          int;
  v_preset   text := nullif(btrim(coalesce(p_preset, '')), '');
  v_space    uuid := p_space;
  v_name     text;
  v_space_team public.general_space_teams%rowtype;
  v_project_team uuid;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  if v_space is null then
    select s.id into v_space
      from public.general_spaces s
      join public.general_space_members m on m.space_id = s.id
     where m.user_id = auth.uid() and m.level = 'owner' and s.archived_at is null
     order by s.created_at
     limit 1;
  end if;

  if v_space is null then
    select coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '')
                      || '''s space', 'My space')
      into v_name
      from public.profiles pr where pr.id = auth.uid();

    insert into public.general_spaces (name, description, created_by)
    values (coalesce(v_name, 'My space'), '', auth.uid())
    returning id into v_space;

    insert into public.general_space_members (space_id, user_id, level)
    values (v_space, auth.uid(), 'owner');
  elsif not public.is_general_space_member(v_space) then
    raise exception 'You are not in that space, so you cannot create a project in it'
      using errcode = 'insufficient_privilege';
  elsif public.general_space_is_archived(v_space) then
    raise exception 'That space is archived. An Owner can restore it to add projects.'
      using errcode = 'check_violation';
  end if;

  if p_space_team is not null then
    select * into v_space_team
      from public.general_space_teams t
     where t.id = p_space_team and t.space_id = v_space;
    if not found then
      raise exception 'That team is not in this space' using errcode = 'invalid_parameter_value';
    end if;
    if not public.general_space_team_can_use(p_space_team) then
      raise exception 'You are not a member of that team' using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.general_projects
    (name, description, starts_on, ends_on, created_by, preset, has_code, space_id)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid(),
          v_preset, v_preset is not distinct from 'capstone', v_space)
  returning * into p;

  insert into public.general_members (project_id, user_id, level)
  values (p.id, auth.uid(), 'owner');

  if p_space_team is not null then
    insert into public.general_teams (project_id, name, space_team_id)
    values (p.id, v_space_team.name, p_space_team)
    returning id into v_project_team;

    insert into public.general_members (project_id, user_id, level)
    select p.id, tm.user_id,
           case when tm.user_id = auth.uid() then 'owner' else 'member' end::public.general_level
      from public.general_space_team_members tm
     where tm.team_id = p_space_team
    on conflict (project_id, user_id) do nothing;

    insert into public.general_team_members (team_id, project_id, user_id)
    select v_project_team, p.id, tm.user_id
      from public.general_space_team_members tm
     where tm.team_id = p_space_team
    on conflict (team_id, user_id) do nothing;

    team_ids := jsonb_build_object(v_space_team.name, v_project_team);
  end if;

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

revoke all on function public.list_general_space_teams(uuid) from public, anon;
revoke all on function public.list_general_space_teams(uuid, boolean) from public, anon;
revoke all on function public.list_general_space_team_members(uuid) from public, anon;
revoke all on function public.create_general_space_team(uuid, text, text, uuid[]) from public, anon;
revoke all on function public.update_general_space_team(uuid, text, text) from public, anon;
revoke all on function public.archive_general_space_team(uuid, boolean) from public, anon;
revoke all on function public.delete_general_space_team(uuid) from public, anon;
revoke all on function public.add_general_space_team_member(uuid, uuid) from public, anon;
revoke all on function public.remove_general_space_team_member(uuid, uuid) from public, anon;
revoke all on function public.set_general_space_team_level(uuid, uuid, public.general_level) from public, anon;
revoke all on function public.create_general_project(text, text, date, date, text, jsonb, uuid, uuid) from public, anon;

grant execute on function public.list_general_space_teams(uuid) to authenticated;
grant execute on function public.list_general_space_teams(uuid, boolean) to authenticated;
grant execute on function public.list_general_space_team_members(uuid) to authenticated;
grant execute on function public.create_general_space_team(uuid, text, text, uuid[]) to authenticated;
grant execute on function public.update_general_space_team(uuid, text, text) to authenticated;
grant execute on function public.archive_general_space_team(uuid, boolean) to authenticated;
grant execute on function public.delete_general_space_team(uuid) to authenticated;
grant execute on function public.add_general_space_team_member(uuid, uuid) to authenticated;
grant execute on function public.remove_general_space_team_member(uuid, uuid) to authenticated;
grant execute on function public.set_general_space_team_level(uuid, uuid, public.general_level) to authenticated;
grant execute on function public.create_general_project(text, text, date, date, text, jsonb, uuid, uuid) to authenticated;

commit;
