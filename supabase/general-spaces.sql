-- Spaces: the container a General project lives in.
--
-- General projects were a flat list. A space holds projects, and everything a
-- project already holds stays exactly where it is — this file adds a level
-- above a project and changes nothing inside one.
--
-- The rule: everyone in a space READS every project in it. Writing still needs
-- project membership. That split is the whole design, and it is why the read
-- widening goes through a new can_read_general_project rather than through
-- is_general_member — is_general_member also backs shares_general_project_with,
-- which decides who may read a profile row, and profile rows carry emails.
-- Widening it would hand every space member the email of every person in every
-- project in the space.
--
-- "Space", not "workplace": public.workplace is already the Education/General
-- enum and profiles.home_workplace is already which one you land in.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_spaces_name_len check (char_length(btrim(name)) between 1 and 80)
);

drop trigger if exists general_spaces_touch on public.general_spaces;
create trigger general_spaces_touch before update on public.general_spaces
  for each row execute function public.touch_updated_at();

create table if not exists public.general_space_members (
  space_id  uuid not null references public.general_spaces (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  level     public.general_level not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists general_space_members_user_idx
  on public.general_space_members (user_id);

create table if not exists public.general_space_invitations (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.general_spaces (id) on delete cascade,
  invitee     uuid not null references public.profiles (id) on delete cascade,
  invited_by  uuid references public.profiles (id) on delete set null,
  status      public.general_invite_status not null default 'pending',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create unique index if not exists general_space_invitations_one_pending
  on public.general_space_invitations (space_id, invitee) where status = 'pending';
create index if not exists general_space_invitations_invitee_idx
  on public.general_space_invitations (invitee, status);

create table if not exists public.general_space_join_codes (
  space_id   uuid primary key references public.general_spaces (id) on delete cascade,
  code       text not null unique,
  open       boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

/** A deactivated account is a member of nothing, whatever rows still exist. */
create or replace function public.is_general_space_member(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space
       and m.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;

create or replace function public.is_general_space_owner(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_space_member(p_space) and exists (
    select 1 from public.general_space_members m
     where m.space_id = p_space and m.user_id = auth.uid() and m.level = 'owner'
  );
$$;

create or replace function public.general_space_is_archived(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.general_spaces where id = p_space),
    false
  );
$$;

/**
 * Two pairs, mirroring general_has/general_can on a project: `has` ignores
 * archiving so a refused write can still reach a message that says why, `can`
 * is the one a policy uses.
 *
 * Manage  — rename, describe, archive the space. Owner only.
 * Invite  — invitations, the join code, removing people, changing levels.
 *           Owner and Manager.
 */
create or replace function public.general_space_has_manage(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_space_owner(p_space);
$$;

create or replace function public.general_space_can_manage(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.general_space_is_archived(p_space)
     and public.general_space_has_manage(p_space);
$$;

create or replace function public.general_space_has_invite(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_space_member(p_space) and exists (
    select 1 from public.general_space_members m
     where m.space_id = p_space and m.user_id = auth.uid()
       and m.level in ('owner', 'manager')
  );
$$;

create or replace function public.general_space_can_invite(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.general_space_is_archived(p_space)
     and public.general_space_has_invite(p_space);
$$;

-- ---------------------------------------------------------------- the column

alter table public.general_projects
  add column if not exists space_id uuid references public.general_spaces (id) on delete cascade;

create index if not exists general_projects_space_idx
  on public.general_projects (space_id);

/*
 * The migration, and the constraint it enables, in ONE transaction.
 *
 * An earlier migration in this project split a two-step change across two
 * transactions; the second step failed on a dependency, and the re-run folded
 * live data in twice. Everything here is inside the file's single begin/commit.
 *
 * Guarded on "is there a project without a space", so it runs once and is a
 * no-op on every later run — including for spaces people create themselves,
 * which must never be touched by a re-run.
 */
do $$
declare
  stray int;
begin
  if not exists (select 1 from public.general_projects where space_id is null) then
    return;
  end if;

  /*
   * Refuse to guess.
   *
   * One space per creator only stays private if that creator's projects all
   * have the same people in them. If creator A has P1 (members A, B) and P2
   * (members A, C), folding both into A's space shows B a project they were
   * never on. Today every project has exactly one member, so this finds
   * nothing — but the data can change before this runs, and a silent leak is
   * worse than a failed migration.
   *
   * The member list has to come from a derived table: p.id is not in the
   * `group by`, so the inline one-statement version does not parse.
   */
  select count(*) into stray from (
    select created_by
      from (
        select p.created_by,
               (select array_agg(m.user_id order by m.user_id)
                  from public.general_members m
                 where m.project_id = p.id) as members
          from public.general_projects p
         where p.created_by is not null
      ) s
     group by created_by
    having count(distinct members) > 1
  ) t;

  if stray > 0 then
    raise exception
      'Cannot place existing projects into spaces: % creator(s) own projects with different member lists. Folding them into one space would show somebody a project they were never on. Place those projects by hand first.', stray
      using errcode = 'check_violation';
  end if;

  -- One space per creator, named after them.
  with creators as (
    select distinct created_by as uid
      from public.general_projects
     where created_by is not null and space_id is null
  ),
  made as (
    insert into public.general_spaces (name, description, created_by)
    select coalesce(
             nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') || '''s space',
             'My space'),
           'The projects that were here before spaces existed.',
           c.uid
      from creators c
      join public.profiles pr on pr.id = c.uid
    returning id, created_by
  )
  update public.general_projects gp
     set space_id = made.id
    from made
   where gp.created_by = made.created_by and gp.space_id is null;

  -- Everyone already on one of those projects joins the space.
  insert into public.general_space_members (space_id, user_id, level)
  select gp.space_id, gm.user_id,
         (case when bool_or(gm.user_id = s.created_by) then 'owner' else 'member' end)
           ::public.general_level
    from public.general_projects gp
    join public.general_members gm on gm.project_id = gp.id
    join public.general_spaces s on s.id = gp.space_id
   where gp.space_id is not null
   group by gp.space_id, gm.user_id
  on conflict (space_id, user_id) do nothing;

  -- The creator owns their space even if they left every project in it.
  insert into public.general_space_members (space_id, user_id, level)
  select s.id, s.created_by, 'owner'
    from public.general_spaces s
   where s.created_by is not null
  on conflict (space_id, user_id) do update set level = 'owner';

  -- A project whose creator was deleted has no space to go to. There are none
  -- today; if one appears, it needs a decision, not a default.
  if exists (select 1 from public.general_projects where space_id is null) then
    raise exception
      'Some projects have no creator, so they cannot be placed into a space. Give them a creator or a space by hand.'
      using errcode = 'check_violation';
  end if;
end $$;

-- Safe to re-run: setting NOT NULL on an already-NOT NULL column is a no-op.
alter table public.general_projects alter column space_id set not null;

-- ---------------------------------------------------------------- reading a project

/**
 * May the caller READ this project?
 *
 * A direct project member, or anyone in the space that holds it. This is the
 * only thing the space widens. Writing keeps going through general_has /
 * general_can, which read general_members.level and know nothing about spaces,
 * so a space member who is not a project member reads everything and writes
 * nothing.
 */
create or replace function public.can_read_general_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project)
      or public.is_general_space_member(
           (select space_id from public.general_projects where id = p_project));
$$;

-- ---------------------------------------------------------------- RLS: spaces

alter table public.general_spaces            enable row level security;
alter table public.general_space_members     enable row level security;
alter table public.general_space_invitations enable row level security;
alter table public.general_space_join_codes  enable row level security;

-- No write policy on general_spaces: name, description and archiving all move
-- through RPCs, so there is no path that could set created_by or archived_at
-- directly and no guard trigger is needed to stop one.
drop policy if exists general_spaces_select on public.general_spaces;
create policy general_spaces_select on public.general_spaces
  for select using (
    public.is_general_space_member(id)
    or (
      public.general_viewer_active()
      and exists (
        select 1 from public.general_space_invitations i
         where i.space_id = general_spaces.id
           and i.invitee = auth.uid() and i.status = 'pending'
      )
    )
  );

drop policy if exists general_space_members_select on public.general_space_members;
create policy general_space_members_select on public.general_space_members
  for select using (public.is_general_space_member(space_id));

drop policy if exists general_space_invitations_select on public.general_space_invitations;
create policy general_space_invitations_select on public.general_space_invitations
  for select using (
    (invitee = auth.uid() and public.general_viewer_active())
    or public.general_space_has_invite(space_id)
  );

-- The code changes only through set_general_space_join_code.
drop policy if exists general_space_join_codes_select on public.general_space_join_codes;
create policy general_space_join_codes_select on public.general_space_join_codes
  for select using (public.general_space_has_invite(space_id));

-- ---------------------------------------------------------------- RLS: the widening

/*
 * Every project-scoped SELECT policy moves from is_general_member to
 * can_read_general_project. All of these tables carry project_id, so one loop
 * does them — the same shape general.sql already uses for teams and positions.
 *
 * Deliberately NOT in this list:
 *   general_join_codes        a space member must not be handed the code to
 *                             join a project they are only watching
 *   general_access_requests   own row, or the project's Owner
 *   general_invitations       own row, or whoever may invite
 *   general_drafts            a person's own unsubmitted work
 *   general_draft_files       likewise
 *   profiles                  shares_general_project_with stays narrow; this
 *                             is the email guard and the reason for this whole
 *                             function split
 */
do $$
declare
  t text;
begin
  foreach t in array array[
    'general_members', 'general_teams', 'general_team_members',
    'general_positions', 'general_position_holders', 'general_grants',
    'general_fields',
    'general_tasks', 'general_task_assignees', 'general_task_comments',
    'general_task_files', 'general_task_logs', 'general_task_events',
    'general_repos', 'general_commits', 'general_blobs',
    'general_repo_changes', 'general_repo_comments'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.can_read_general_project(project_id))',
      t || '_select', t);
  end loop;
end $$;

-- The two that are not a plain project_id column.
drop policy if exists general_projects_select on public.general_projects;
create policy general_projects_select on public.general_projects
  for select using (
    public.can_read_general_project(id)
    or (
      public.general_viewer_active()
      and exists (
        select 1 from public.general_invitations i
         where i.project_id = general_projects.id
           and i.invitee = auth.uid() and i.status = 'pending'
      )
    )
  );

drop policy if exists general_field_values_select on public.general_field_values;
create policy general_field_values_select on public.general_field_values
  for select using (
    public.can_read_general_project(public.general_field_project(field_id)));

-- ---------------------------------------------------------------- the overview view

/*
 * general_project_overview inner-joined the caller's own general_members row to
 * get my_level, so widening the table policies was not enough on its own: a
 * space member could read general_projects and still get nothing back from the
 * view. A left join fixes it and makes my_level null for somebody who is in the
 * space but not on the project — which is exactly what they hold.
 *
 * Body copied from supabase/general-files.sql:407; keep the two in step. The
 * column list is unchanged and in the same order, which is all that `create or
 * replace view` allows.
 *
 * Anything reading my_level must treat null as "no permissions" rather than
 * assuming a level is always there.
 */
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
       p.has_code,
       -- Appended last, which is the only shape `create or replace view` takes.
       p.space_id
  from public.general_projects p
  left join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id
  ) t on true;

grant select on public.general_project_overview to authenticated;

-- ---------------------------------------------------------------- the space view

/*
 * One row per space the viewer can see, with what is inside it.
 *
 * Left join on membership for the same reason general_project_overview uses
 * one: somebody holding a pending invitation may read the space row, and an
 * inner join would hand them nothing to draw a card with. my_level is null for
 * them, and the counts come back as whatever RLS lets them read — which is
 * zero until they accept.
 */
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
         where p.space_id = s.id and p.archived_at is not null)::int as archived_count
  from public.general_spaces s
  left join public.general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

grant select on public.general_space_overview to authenticated;

-- ---------------------------------------------------------------- RPCs: the space

create or replace function public.create_general_space(
  p_name        text,
  p_description text default ''
) returns public.general_spaces
language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a space'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_space_create', 10, interval '1 hour',
    'You have created a lot of spaces in the last hour. Try again later.');

  insert into public.general_spaces (name, description, created_by)
  values (btrim(p_name), coalesce(p_description, ''), auth.uid())
  returning * into s;

  insert into public.general_space_members (space_id, user_id, level)
  values (s.id, auth.uid(), 'owner');

  return s;
end;
$$;

create or replace function public.update_general_space(
  p_space       uuid,
  p_name        text,
  p_description text
) returns public.general_spaces
language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.general_space_has_manage(p_space) then
    raise exception 'Only an Owner changes a space' using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_spaces
     set name = btrim(p_name), description = coalesce(p_description, '')
   where id = p_space
  returning * into s;
  return s;
end;
$$;

create or replace function public.archive_general_space(
  p_space    uuid,
  p_archived boolean
) returns public.general_spaces
language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.is_general_space_owner(p_space) then
    raise exception 'Only an Owner archives a space' using errcode = 'insufficient_privilege';
  end if;

  update public.general_spaces
     set archived_at = case when p_archived then now() else null end
   where id = p_space
  returning * into s;
  return s;
end;
$$;

create or replace function public.delete_general_space(
  p_space uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_space_owner(p_space) then
    raise exception 'Only an Owner deletes a space' using errcode = 'insufficient_privilege';
  end if;

  delete from public.general_spaces where id = p_space;
  if not found then
    raise exception 'Space not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------- RPCs: joining

create or replace function public.set_general_space_join_code(
  p_space      uuid,
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
  if not public.general_space_has_invite(p_space) then
    raise exception 'You need permission to change this space''s join code'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select jc.code into v_code from public.general_space_join_codes jc
   where jc.space_id = p_space for update;
  if p_open and (v_code is null or p_regenerate) then
    loop
      raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      v_code := '';
      -- Bytes 6 and 8 carry the uuid version and variant bits; skip them.
      foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
        v_code := v_code || substr(alphabet, 1 + get_byte(raw, i) % 31, 1);
      end loop;
      exit when not exists (
        select 1 from public.general_space_join_codes jc where jc.code = v_code);
    end loop;
  end if;

  if v_code is null then
    return null; -- closing a code that was never opened
  end if;

  insert into public.general_space_join_codes (space_id, code, open)
  values (p_space, v_code, p_open)
  on conflict (space_id) do update
    set code = excluded.code, open = excluded.open, updated_at = now();

  return v_code;
end;
$$;

/**
 * A wrong or closed code returns null rather than raising, so the rate-limit
 * count taken above it is not rolled back by the failure — a miss still costs
 * an attempt. Being deactivated or over the limit still raises: those are
 * refusals, not misses.
 */
create or replace function public.join_general_space(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a space'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  perform public.rate_limit('general_space_join', 10, interval '10 minutes',
    'Too many join attempts. Wait a few minutes and try again.');

  select sp.* into s
    from public.general_space_join_codes jc
    join public.general_spaces sp on sp.id = jc.space_id
   where jc.code = upper(btrim(p_code)) and jc.open and sp.archived_at is null;
  if s.id is null then
    return null; -- a miss, not a refusal; the rate-limit count already committed
  end if;

  insert into public.general_space_members (space_id, user_id)
  values (s.id, auth.uid())
  on conflict do nothing;

  update public.general_space_invitations
     set status = 'accepted', answered_at = now()
   where space_id = s.id and invitee = auth.uid() and status = 'pending';

  return s.id;
end;
$$;

-- ---------------------------------------------------------------- RPCs: invitations

create or replace function public.invite_to_general_space(
  p_space uuid,
  p_user  uuid
) returns public.general_space_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_space_invitations%rowtype;
begin
  if not public.general_space_can_invite(p_space) then
    raise exception 'You need permission to invite people to this space'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.general_space_members
              where space_id = p_space and user_id = p_user) then
    raise exception 'They are already in this space' using errcode = 'unique_violation';
  end if;

  perform public.rate_limit('general_space_invite', 60, interval '1 hour',
    'You have sent a lot of invitations in the last hour. Try again later.');

  insert into public.general_space_invitations (space_id, invitee, invited_by)
  values (p_space, p_user, auth.uid())
  returning * into inv;
  return inv;
end;
$$;

create or replace function public.respond_general_space_invitation(
  p_invitation uuid,
  p_accept     boolean
) returns public.general_space_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_space_invitations%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to answer an invitation'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.general_space_invitations
   where id = p_invitation for update;
  if inv.id is null or inv.invitee is distinct from auth.uid() then
    raise exception 'That invitation is not yours to answer'
      using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered or withdrawn'
      using errcode = 'check_violation';
  end if;
  if p_accept and public.general_space_is_archived(inv.space_id) then
    raise exception 'That space is archived, so it cannot take new members'
      using errcode = 'check_violation';
  end if;

  update public.general_space_invitations
     set status = case when p_accept then 'accepted' else 'declined' end
                    ::public.general_invite_status,
         answered_at = now()
   where id = p_invitation
  returning * into inv;

  if p_accept then
    insert into public.general_space_members (space_id, user_id)
    values (inv.space_id, auth.uid())
    on conflict do nothing;
  end if;
  return inv;
end;
$$;

create or replace function public.withdraw_general_space_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_space_invitations%rowtype;
begin
  select * into inv from public.general_space_invitations
   where id = p_invitation for update;
  if inv.id is null then
    raise exception 'That invitation is gone' using errcode = 'no_data_found';
  end if;
  if not public.general_space_can_invite(inv.space_id) then
    raise exception 'You need permission to withdraw this invitation'
      using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered' using errcode = 'check_violation';
  end if;

  update public.general_space_invitations
     set status = 'withdrawn', answered_at = now()
   where id = p_invitation;
end;
$$;

-- ---------------------------------------------------------------- RPCs: membership

create or replace function public.set_general_space_level(
  p_space uuid,
  p_user  uuid,
  p_level public.general_level
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_space_members%rowtype;
  owners int;
begin
  if not public.is_general_space_owner(p_space) then
    raise exception 'Only an Owner changes access levels'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- Every Owner row locked before counting, so two Owners stepping down at
  -- once cannot both see the other still there.
  perform 1 from public.general_space_members
   where space_id = p_space and level = 'owner' for update;

  select * into target from public.general_space_members
   where space_id = p_space and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not in this space' using errcode = 'no_data_found';
  end if;

  -- Stepping down a deactivated Owner never changes how many active Owners
  -- there are, so it is never blocked — only demoting somebody who is still
  -- active can leave the space with zero of them.
  if target.level = 'owner' and p_level <> 'owner'
     and exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    select count(*) into owners
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space and m.level = 'owner' and pr.status <> 'rejected';
    if owners <= 1 then
      raise exception 'A space needs at least one Owner. Make someone else an Owner first.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.general_space_members set level = p_level
   where space_id = p_space and user_id = p_user;
end;
$$;

create or replace function public.remove_general_space_member(
  p_space uuid,
  p_user  uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_space_members%rowtype;
  owners int;
begin
  -- Leaving on your own account needs no permission; removing somebody else does.
  if p_user is distinct from auth.uid()
     and not public.general_space_can_invite(p_space) then
    raise exception 'You need permission to remove someone from this space'
      using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() and not public.general_viewer_active() then
    raise exception 'Sign in with an active account to leave a space'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.general_space_members
   where space_id = p_space and level = 'owner' for update;

  select * into target from public.general_space_members
   where space_id = p_space and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not in this space' using errcode = 'no_data_found';
  end if;

  -- A Manager cannot remove an Owner.
  if target.level = 'owner' and not public.is_general_space_owner(p_space) then
    raise exception 'Only an Owner removes another Owner'
      using errcode = 'insufficient_privilege';
  end if;

  if target.level = 'owner'
     and exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    select count(*) into owners
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space and m.level = 'owner' and pr.status <> 'rejected';
    if owners <= 1 then
      raise exception 'A space needs at least one Owner. Make someone else an Owner first.'
        using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_space_members
   where space_id = p_space and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------- RPCs: lists

/**
 * Pending space invitations sent to the caller. Never the inviter's profile
 * row — just enough of it to draw a card.
 */
create or replace function public.list_my_general_space_invitations()
returns table (
  invitation_id      uuid,
  space_id           uuid,
  space_name         text,
  space_description  text,
  inviter_id         uuid,
  inviter_first_name text,
  inviter_last_name  text,
  inviter_avatar_url text,
  created_at         timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.general_viewer_active() then
    return;
  end if;

  return query
    select i.id, i.space_id, s.name, s.description,
           i.invited_by, pr.first_name, pr.last_name, pr.avatar_url, i.created_at
      from public.general_space_invitations i
      join public.general_spaces s on s.id = i.space_id
      left join public.profiles pr on pr.id = i.invited_by
     where i.invitee = auth.uid() and i.status = 'pending'
     order by i.created_at desc;
end;
$$;

/** Who a space has invited. Never their email. */
create or replace function public.list_general_space_invitations(p_space uuid)
returns table (
  invitation_id      uuid,
  invitee_id         uuid,
  invitee_first_name text,
  invitee_last_name  text,
  invitee_avatar_url text,
  invited_by         uuid,
  created_at         timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.general_space_has_invite(p_space) then
    raise exception 'You need permission to see this space''s invitations'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.invitee, pr.first_name, pr.last_name, pr.avatar_url,
           i.invited_by, i.created_at
      from public.general_space_invitations i
      join public.profiles pr on pr.id = i.invitee
     where i.space_id = p_space and i.status = 'pending'
     order by i.created_at desc;
end;
$$;

/** Who is in a space. Never their email. */
create or replace function public.list_general_space_members(p_space uuid)
returns table (
  user_id    uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  level      public.general_level,
  joined_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

/**
 * Who is on a project, for anybody who may read the project.
 *
 * A space member who is not a project member can now read general_members, but
 * profiles_select_general_peer deliberately did not widen with it — so joining
 * to profiles from the client would return rows with no names. This is the way
 * across, and like the invitation lists it hands back a name and an avatar and
 * never an email.
 */
create or replace function public.list_general_project_members(p_project uuid)
returns table (
  user_id    uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  level      public.general_level,
  joined_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_read_general_project(p_project) then
    raise exception 'You cannot see this project' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

-- ---------------------------------------------------------------- creating a project

/*
 * A project is created inside a space.
 *
 * p_space goes last and defaults to null so this file can land on its own,
 * before the pages know anything about spaces: a call that names no space puts
 * the project in the caller's own space, creating it the first time. The old
 * six-argument version is dropped rather than left beside this one — two
 * overloads would make every existing call ambiguous.
 */
drop function if exists public.create_general_project(text, text, date, date, text, jsonb);

create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null,
  p_preset      text default null,
  p_content     jsonb default null,
  p_space       uuid default null
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
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  if v_space is null then
    -- No space named: the caller's own, oldest first so this is stable.
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

  insert into public.general_projects
    (name, description, starts_on, ends_on, created_by, preset, has_code, space_id)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid(),
          v_preset, v_preset is not distinct from 'capstone', v_space)
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

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_general_space(text, text)',
    'update_general_space(uuid, text, text)',
    'archive_general_space(uuid, boolean)',
    'delete_general_space(uuid)',
    'set_general_space_join_code(uuid, boolean, boolean)',
    'join_general_space(text)',
    'invite_to_general_space(uuid, uuid)',
    'respond_general_space_invitation(uuid, boolean)',
    'withdraw_general_space_invitation(uuid)',
    'set_general_space_level(uuid, uuid, public.general_level)',
    'remove_general_space_member(uuid, uuid)',
    'list_my_general_space_invitations()',
    'list_general_space_invitations(uuid)',
    'list_general_space_members(uuid)',
    'list_general_project_members(uuid)',
    'create_general_project(text, text, date, date, text, jsonb, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
