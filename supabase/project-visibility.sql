-- Collabify — company roles, phase 2: who sees a work project, and how people
-- reach a work space.
--
--   node scripts/db.mjs supabase/project-visibility.sql supabase/anon-lockdown.sql
--
-- A work project is read by its members, and by the Owners of its space. Owners
-- who are not on it read only: every write goes through general_can /
-- general_has, which need membership. A plain space member who is not on a
-- project no longer sees it. Every project reader (the general_projects policy,
-- the 18-table policy loop in general-spaces.sql, general_field_values,
-- general_sprints, general_milestones, list_general_project_members, the
-- reports and the security-invoker overview views) already goes through
-- can_read_general_project, so narrowing that one function narrows them all.
-- Reports keep the "see everyone's rows" view for space Owners only (it was
-- Owner or Manager), since only Owners see every project.
--
-- People enter a space through its projects: joining a work project adds you to
-- its space as a plain member. Leaving a project never takes you out of the
-- space. Work-space invites are for co-owners with Project manager turned on
-- (a class's space keeps its co-teacher invite), and space join codes no
-- longer admit anyone.
--
-- Class-board Files projects (`class_board_id` set, in the "Class project
-- files" space) keep their old access entirely: members and that space's
-- members read them, and joining one does not add anyone to the space.
--
-- Runs after project-roles.sql and everything else in docs/07-backup.md, and
-- redefines from their latest (live) copies: can_read_general_project
-- (general-project-archive-rbac.sql), general_report_is_lead
-- (general-reports.sql), invite_to_general_space,
-- respond_general_space_invitation and set_general_space_join_code
-- (general-spaces.sql) and join_general_space (company-accounts.sql). Re-run it
-- after re-running any of those files, then anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- reading

create or replace function public.can_read_general_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.archived_at is not null then public.general_sees_archived(p.id, p.archived_by)
    when p.class_board_id is not null then
      public.is_general_member(p.id) or public.is_general_space_member(p.space_id)
    else public.is_general_member(p.id) or public.is_general_space_owner(p.space_id)
  end
    from public.general_projects p
   where p.id = p_project;
$$;

-- Leads see everyone's rows in reports: the project's leads, and the Owners of
-- its space (who see every project in it).
create or replace function public.general_report_is_lead(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.general_leads(p_project)
      or exists (
        select 1
          from public.general_projects p
          join public.general_space_members m on m.space_id = p.space_id
          join public.profiles pr on pr.id = m.user_id
         where p.id = p_project
           and m.user_id = auth.uid()
           and m.level = 'owner'
           and pr.status <> 'rejected'
      );
$$;

-- ---------------------------------------------------------------- joining

-- Joining a work project adds you to its space as a plain member. Someone
-- already in the space keeps their level.
create or replace function public.add_general_member_to_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.general_space_members (space_id, user_id, level)
  select p.space_id, new.user_id, 'member'
    from public.general_projects p
    join public.general_spaces s on s.id = p.space_id
   where p.id = new.project_id
     and p.class_board_id is null
     and s.kind = 'work'
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists general_members_space on public.general_members;
create trigger general_members_space
  after insert on public.general_members
  for each row execute function public.add_general_member_to_space();

-- Backfill: project members who are not in their project's space yet.
insert into public.general_space_members (space_id, user_id, level)
select distinct p.space_id, m.user_id, 'member'::public.general_level
  from public.general_members m
  join public.general_projects p on p.id = m.project_id
  join public.general_spaces s on s.id = p.space_id
 where p.class_board_id is null
   and s.kind = 'work'
on conflict do nothing;

-- ---------------------------------------------------------------- invites

-- The only work-space invite: an Owner invites someone with Project manager
-- turned on to co-own the space.
create or replace function public.invite_to_general_space(p_space uuid, p_user uuid)
returns public.general_space_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.general_space_invitations%rowtype;
begin
  -- A class's space keeps its own invite: its teachers bring in co-teachers,
  -- who sit at Manager (guard_class_space_member).
  if public.is_education_space(p_space) then
    if not public.general_space_can_invite(p_space) then
      raise exception 'You need permission to invite people to this space'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not public.is_general_space_owner(p_space) then
      raise exception 'Only an Owner of this space can invite co-owners'
        using errcode = 'insufficient_privilege';
    end if;
    if public.general_space_is_archived(p_space) then
      raise exception 'This space is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'no_data_found';
  end if;
  if not public.is_education_space(p_space) and not public.is_project_manager(p_user) then
    raise exception 'Only people with Project manager turned on can co-own a space. Invite them to a project instead.'
      using errcode = 'check_violation';
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

-- Accepting a work space's invite makes you an Owner. Project manager must
-- still be on when you accept; someone who joined the space through a project
-- meanwhile is raised to Owner. A class's space is unchanged: faculty join at
-- Manager (guard_class_space_member).
create or replace function public.respond_general_space_invitation(p_invitation uuid, p_accept boolean)
returns public.general_space_invitations
language plpgsql
security definer
set search_path = public
as $$
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
  if p_accept and not public.is_education_space(inv.space_id)
     and not public.is_project_manager(auth.uid()) then
    raise exception 'Only people with Project manager turned on can co-own a space. Ask an admin to turn it on, then accept again.'
      using errcode = 'check_violation';
  end if;

  update public.general_space_invitations
     set status = case when p_accept then 'accepted' else 'declined' end
                    ::public.general_invite_status,
         answered_at = now()
   where id = p_invitation
  returning * into inv;

  if p_accept and public.is_education_space(inv.space_id) then
    insert into public.general_space_members (space_id, user_id)
    values (inv.space_id, auth.uid())
    on conflict do nothing;
  elsif p_accept then
    insert into public.general_space_members (space_id, user_id, level)
    values (inv.space_id, auth.uid(), 'owner')
    on conflict (space_id, user_id) do update set level = 'owner'
      where general_space_members.level <> 'owner';
  end if;
  return inv;
end;
$$;

-- ---------------------------------------------------------------- space codes

-- Space codes are retired: opening one is refused. Closing an old one still
-- works.
create or replace function public.set_general_space_join_code(
  p_space uuid, p_open boolean, p_regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_open then
    raise exception 'Space codes are retired. Share a project code instead.'
      using errcode = 'check_violation';
  end if;
  if not public.general_space_has_invite(p_space) then
    raise exception 'You need permission to change this space''s join code'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_space_join_codes
     set open = false, updated_at = now()
   where space_id = p_space
  returning code into v_code;
  return v_code; -- null when no code was ever opened
end;
$$;

create or replace function public.join_general_space(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Space codes are retired. Share a project code instead.'
    using errcode = 'check_violation';
end;
$$;

-- None are open live; this keeps a rebuilt database the same.
update public.general_space_join_codes set open = false, updated_at = now() where open;

-- ---------------------------------------------------------------- grants

revoke execute on function public.add_general_member_to_space() from public, anon, authenticated;

commit;
