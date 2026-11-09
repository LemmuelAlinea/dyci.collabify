begin;

-- supabase/space-roles.sql
-- Work spaces get the same roles as work projects: general_space_members.role is the
-- source of truth and level is derived from it. Class (education) spaces keep the level
-- model and a null role.
-- Runs after project-member-import.sql and before anon-lockdown.sql. Idempotent.

alter table public.general_space_members
  add column if not exists role public.general_role;
alter table public.general_space_invitations
  add column if not exists invited_role public.general_role not null default 'member';

-- Keeps role and level in step. Fires before general_space_members_class and
-- general_space_members_student_level (same-timing triggers fire by name).
create or replace function public.sync_general_space_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.general_spaces s
              where s.id = new.space_id and s.kind = 'education') then
    new.role := null;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := public.general_member_role_for(true, coalesce(new.role, 'member'), new.level, null, null);
  else
    new.role := public.general_member_role_for(false, coalesce(new.role, 'member'), new.level, old.role, old.level);
  end if;
  new.level := public.general_role_level(new.role);
  return new;
end;
$$;

drop trigger if exists general_space_members_a_sync_role on public.general_space_members;
create trigger general_space_members_a_sync_role
  before insert or update of role, level on public.general_space_members
  for each row execute function public.sync_general_space_member_role();

-- Launch backfill: work-space rows only, and never a role that is already set.
update public.general_space_members m
   set role = case m.level when 'owner' then 'pm' when 'manager' then 'coordinator' else 'member' end::public.general_role
 where m.role is null
   and exists (select 1 from public.general_spaces s where s.id = m.space_id and s.kind = 'work');

create unique index if not exists general_space_members_one_pm
  on public.general_space_members (space_id) where role = 'pm';

-- Owner invitations no longer exist; the project manager is fixed.
update public.general_space_invitations
   set status = 'withdrawn', answered_at = coalesce(answered_at, now())
 where status = 'pending' and invited_level = 'owner';

create or replace function public.guard_student_level()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.general_role;
begin
  -- Nested, not joined with `and`: the other tables have no project_id, and
  -- plpgsql resolves every field in an expression before evaluating it.
  if tg_table_name = 'general_members' then
    if exists (select 1 from public.general_projects p
                where p.id = new.project_id and p.class_board_id is null) then
      if tg_op = 'INSERT' then
        v_role := public.general_member_role_for(true, new.role, new.level, null, null);
      else
        v_role := public.general_member_role_for(false, new.role, new.level, old.role, old.level);
      end if;
      if v_role = 'pm' and public.is_student(new.user_id) then
        raise exception 'A student cannot be the project manager.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  end if;

  if tg_table_name = 'general_space_members' then
    if exists (select 1 from public.general_spaces s
                where s.id = new.space_id and s.kind = 'work') then
      if new.role = 'pm' and public.is_student(new.user_id) then
        raise exception 'A student cannot be the project manager.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  end if;

  if auth.uid() is not null and new.level <> 'member' and public.is_student(new.user_id) then
    raise exception 'A student can only be a member. Owner and Manager are for members and teachers.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

-- A role change alone must reach the guard too.
drop trigger if exists general_space_members_student_level on public.general_space_members;
create trigger general_space_members_student_level
  before insert or update of level, role on public.general_space_members
  for each row execute function public.guard_student_level();

create or replace function public.notify_general_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  who uuid := coalesce(new.user_id, old.user_id);
  label text;
  msg text;
begin
  if auth.uid() is null or auth.uid() = who then return coalesce(new, old); end if;

  if tg_table_name = 'general_members' then
    -- A class board's Files project is kept in step with the group by the
    -- database; nobody is removed by a person, so nobody is told.
    select name into label from public.general_projects
     where id = coalesce(new.project_id, old.project_id) and class_board_id is null;
  else
    select name into label from public.general_spaces
     where id = coalesce(new.space_id, old.space_id) and kind = 'work';
  end if;
  if label is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    msg := public.display_name(auth.uid()) || ' removed you';
  elsif tg_table_name = 'general_members' then
    -- Only work projects get this far, and they hold roles.
    msg := 'You are now ' || public.general_role_phrase(new.role);
  else
    -- Only work spaces get this far, and they hold roles too.
    msg := 'You are now ' || public.general_role_phrase(new.role);
  end if;

  if tg_table_name = 'general_members' then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select who, 'membership_changed', case when tg_op = 'DELETE' then null else new.project_id end, label, msg
      from public.notification_prefs np
     where np.user_id = who and np.project_updates;
  else
    insert into public.notifications (user_id, type, general_space_id, title, preview)
    select who, 'membership_changed', case when tg_op = 'DELETE' then null else new.space_id end, label, msg
      from public.notification_prefs np
     where np.user_id = who and np.project_updates;
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists general_space_members_notify_level on public.general_space_members;
create trigger general_space_members_notify_level
  after update of level, role on public.general_space_members
  for each row
  when (old.level is distinct from new.level or old.role is distinct from new.role)
  execute function public.notify_general_membership();

create or replace view public.general_space_overview as
 select s.id,
    s.name,
    s.description,
    s.created_by,
    s.archived_at,
    s.created_at,
    s.updated_at,
    m.level as my_level,
    (( select count(*) from general_space_members x where x.space_id = s.id))::integer as member_count,
    (( select count(*) from general_projects p
        where p.space_id = s.id and p.archived_at is null))::integer as project_count,
    (( select count(*) from general_projects p
        where p.space_id = s.id and p.archived_at is not null))::integer as archived_count,
    s.kind,
    ( select c.id from classes c where c.space_id = s.id) as class_id,
    m.role as my_role
   from general_spaces s
     left join general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

drop function if exists public.list_general_space_members(uuid);
create function public.list_general_space_members(p_space uuid)
returns table(user_id uuid, first_name text, last_name text, avatar_url text,
              level public.general_level, joined_at timestamp with time zone,
              is_student boolean, role public.general_role)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student', m.role
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space
     order by m.level, pr.last_name, pr.first_name;
end;
$function$;
revoke execute on function public.list_general_space_members(uuid) from public, anon;
grant execute on function public.list_general_space_members(uuid) to authenticated, service_role;

drop function if exists public.list_general_space_invitations(uuid);
create function public.list_general_space_invitations(p_space uuid)
returns table(invitation_id uuid, invitee_id uuid, invitee_first_name text,
              invitee_last_name text, invitee_avatar_url text, invited_by uuid,
              created_at timestamp with time zone, invited_level public.general_level,
              invited_role public.general_role)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.general_space_manages_invites(p_space) then
    raise exception 'You need permission to see this space''s invitations'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.invitee, pr.first_name, pr.last_name, pr.avatar_url,
           i.invited_by, i.created_at, i.invited_level, i.invited_role
      from public.general_space_invitations i
      join public.profiles pr on pr.id = i.invitee
     where i.space_id = p_space and i.status = 'pending'
     order by i.created_at desc;
end;
$function$;
revoke execute on function public.list_general_space_invitations(uuid) from public, anon;
grant execute on function public.list_general_space_invitations(uuid) to authenticated, service_role;

-- The person's space role for a work project's space, pm read as coordinator.
-- Null for a class board or a person with no space role.
create or replace function public.general_space_default_role(p_project uuid, p_user uuid)
returns public.general_role
language sql
stable
security definer
set search_path to 'public'
as $$
  select case m.role when 'pm' then 'coordinator' else m.role::text end::public.general_role
    from public.general_projects p
    join public.general_space_members m on m.space_id = p.space_id and m.user_id = p_user
   where p.id = p_project and p.class_board_id is null;
$$;
revoke execute on function public.general_space_default_role(uuid, uuid) from public, anon, authenticated;

-- The shared gate of set and preview. Returns true when the caller is the space's
-- project manager, false for a coordinator. Locks the pm row, then the target row.
create or replace function public.general_space_role_gate(
  p_space uuid,
  p_user  uuid,
  p_role  public.general_role
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me     public.general_role;
  target public.general_role;
begin
  if not exists (select 1 from public.general_spaces s where s.id = p_space and s.kind = 'work') then
    raise exception 'Roles apply to work spaces. Change a class member''s access level instead.'
      using errcode = 'check_violation';
  end if;
  if not public.general_space_has_invite(p_space) then
    raise exception 'You need permission to change roles in this space.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;

  perform 1 from public.general_space_members
   where space_id = p_space and role = 'pm' for update;
  select role into target from public.general_space_members
   where space_id = p_space and user_id = p_user for update;
  if target is null then
    raise exception 'They are not in this space' using errcode = 'no_data_found';
  end if;

  -- Asked again under the lock: a hand over may have moved the caller since.
  select role into me from public.general_space_members
   where space_id = p_space and user_id = auth.uid();
  if me is null or me not in ('pm', 'coordinator') then
    raise exception 'You need permission to change roles in this space.'
      using errcode = 'insufficient_privilege';
  end if;

  if target = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if me = 'coordinator' then
    if target not in ('member', 'qa', 'stakeholder') then
      raise exception 'Only the project manager can change a coordinator.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_role = 'coordinator' then
      raise exception 'Only the project manager can make someone a coordinator.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return me = 'pm';
end;
$$;
revoke all on function public.general_space_role_gate(uuid, uuid, public.general_role) from public, anon, authenticated;

-- Live work projects a space role change reaches.
create or replace function public.general_space_role_targets(
  p_space uuid,
  p_user  uuid,
  p_role  public.general_role,
  p_by_pm boolean
) returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.general_projects p
    join public.general_members g on g.project_id = p.id and g.user_id = p_user
   where p.space_id = p_space
     and p.class_board_id is null
     and p.archived_at is null
     and g.role <> 'pm'
     and g.role <> p_role
     and (p_by_pm or g.role <> 'coordinator');
$$;
revoke all on function public.general_space_role_targets(uuid, uuid, public.general_role, boolean) from public, anon, authenticated;

create or replace function public.preview_general_space_role(
  p_space uuid,
  p_user  uuid,
  p_role  public.general_role
) returns table (project_count int, task_count int, qa_start_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  by_pm boolean;
begin
  by_pm := public.general_space_role_gate(p_space, p_user, p_role);
  return query
    select count(*)::int,
           case when p_role in ('qa', 'stakeholder') then
             (select count(*)::int from public.general_task_assignees a
               where a.user_id = p_user
                 and a.project_id in (select public.general_space_role_targets(p_space, p_user, p_role, by_pm)))
           else 0 end,
           case when p_role = 'qa' then
             (count(*) filter (where not exists (
               select 1 from public.general_members m
                 join public.profiles pq on pq.id = m.user_id
                where m.project_id = t and m.role = 'qa' and pq.status = 'active')))::int
           else 0 end
      from public.general_space_role_targets(p_space, p_user, p_role, by_pm) t;
end;
$$;
revoke all on function public.preview_general_space_role(uuid, uuid, public.general_role) from public, anon;
grant execute on function public.preview_general_space_role(uuid, uuid, public.general_role) to authenticated;

create or replace function public.set_general_space_role(
  p_space uuid,
  p_user  uuid,
  p_role  public.general_role
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  by_pm boolean;
  proj  uuid;
  n     int := 0;
begin
  by_pm := public.general_space_role_gate(p_space, p_user, p_role);

  -- The projects are read before the space row changes: the change does not touch them.
  for proj in select public.general_space_role_targets(p_space, p_user, p_role, by_pm) loop
    -- The conditions repeat the target rules on the row itself: a hand over or a
    -- project role change can land between the read and this update.
    update public.general_members g set role = p_role
      from public.general_projects pr
     where pr.id = g.project_id and pr.archived_at is null
       and g.project_id = proj and g.user_id = p_user
       and g.role <> 'pm' and g.role <> p_role
       and (by_pm or g.role <> 'coordinator');
    if not found then
      continue;
    end if;

    -- Grants are extras for members only (set_general_member_role, project-qa.sql).
    if p_role <> 'member' then
      delete from public.general_grants where project_id = proj and user_id = p_user;
      update public.general_access_requests
         set status = 'withdrawn', answered_at = now()
       where project_id = proj and user_id = p_user and status = 'open';
    end if;

    if p_role in ('stakeholder', 'qa') then
      perform set_config('collabify.general_archive_op', 'on', true);
      perform set_config('collabify.space_role_cascade', 'on', true);
      delete from public.general_task_assignees where project_id = proj and user_id = p_user;
      perform set_config('collabify.space_role_cascade', 'off', true);
      perform set_config('collabify.general_archive_op', 'off', true);
    end if;
    n := n + 1;
  end loop;

  update public.general_space_members set role = p_role
   where space_id = p_space and user_id = p_user and role <> p_role;
  return n;
end;
$$;
revoke all on function public.set_general_space_role(uuid, uuid, public.general_role) from public, anon;
grant execute on function public.set_general_space_role(uuid, uuid, public.general_role) to authenticated;

create or replace function public.hand_over_general_space(p_space uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.general_spaces s where s.id = p_space and s.kind = 'work') then
    raise exception 'Hand over applies to work spaces.' using errcode = 'check_violation';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  perform 1 from public.general_space_members
   where space_id = p_space and role = 'pm' for update;
  if not exists (select 1 from public.general_space_members
                  where space_id = p_space and user_id = auth.uid() and role = 'pm') then
    raise exception 'Only the project manager can hand over this space.'
      using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.general_space_members
   where space_id = p_space and user_id = p_user for update;
  if not exists (select 1 from public.general_space_members m
                   join public.profiles pr on pr.id = m.user_id
                  where m.space_id = p_space and m.user_id = p_user and pr.status = 'active') then
    raise exception 'They are not an active member of this space.' using errcode = 'no_data_found';
  end if;
  if p_user = auth.uid() then
    raise exception 'Choose someone else to hand the space to.' using errcode = 'check_violation';
  end if;
  if public.is_student(p_user) then
    raise exception 'A student cannot be the project manager.' using errcode = 'check_violation';
  end if;
  if not public.is_project_manager(p_user) then
    raise exception 'They need Project manager turned on first. Ask an admin to turn it on.'
      using errcode = 'check_violation';
  end if;

  -- The old project manager steps aside first: only one row may hold pm.
  update public.general_space_members set role = 'coordinator'
   where space_id = p_space and user_id = auth.uid();
  update public.general_space_members set role = 'pm'
   where space_id = p_space and user_id = p_user;
end;
$$;
revoke all on function public.hand_over_general_space(uuid, uuid) from public, anon;
grant execute on function public.hand_over_general_space(uuid, uuid) to authenticated;

-- Work spaces change a person through the space role; class spaces keep levels.
create or replace function public.set_general_space_level(p_space uuid, p_user uuid, p_level public.general_level)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  target public.general_space_members%rowtype;
  owners int;
begin
  if not public.is_education_space(p_space) then
    raise exception 'Use the space role to change this person.'
      using errcode = 'check_violation';
  end if;
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

  if p_level = 'owner' and target.level <> 'owner'
     and not public.is_education_space(p_space)
     and not public.is_project_manager(p_user) then
    raise exception 'Only people with Project manager turned on can co-own a space. Ask an admin to turn it on first.'
      using errcode = 'check_violation';
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
$function$;

-- guard_general_task_child as live, plus the space role cascade bypass for DELETE.
CREATE OR REPLACE FUNCTION public.guard_general_task_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p uuid;
  -- Leaving an archived project cascades into general_task_assignees; that
  -- delete should go through even though the membership row that drove it is
  -- already gone by the time this trigger fires.
  v_member_gone boolean := false;
  v_role public.general_role;
  t public.general_tasks%rowtype;
  actor_role public.general_role;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- A space role change letting go of a task its target held: the caller need not be
  -- on the project (set_general_space_role sets the flag around that delete only).
  if tg_op = 'DELETE' and tg_table_name = 'general_task_assignees'
     and coalesce(current_setting('collabify.space_role_cascade', true), 'off') = 'on' then
    return old;
  end if;
  if tg_op = 'DELETE' and tg_table_name = 'general_task_assignees' then
    v_member_gone := not exists (
      select 1 from public.general_members
       where project_id = old.project_id and user_id = old.user_id
    );
  end if;
  if not v_member_gone then
    if not public.is_general_member(p) then
      raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
    end if;
    if not public.general_can_write(p) then
      raise exception 'Stakeholders can view this project but not change it.'
        using errcode = 'insufficient_privilege';
    end if;
    if public.general_is_archived(p) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' then
    case tg_table_name
      when 'general_task_assignees' then
        -- Nobody hands a stakeholder or QA a task, whichever policy branch
        -- let the row in: a self-claim, a task manager or a team leader.
        select role into v_role from public.general_members
         where project_id = new.project_id and user_id = new.user_id;
        if v_role = 'stakeholder' then
          raise exception 'Stakeholders can''t hold tasks. Pick someone else.'
            using errcode = 'insufficient_privilege';
        end if;
        if v_role = 'qa' then
          raise exception 'QA can''t hold tasks. Pick someone else.'
            using errcode = 'insufficient_privilege';
        end if;
        new.assigned_by := auth.uid();
        -- Serializes claims and routing against the same task row.
        select * into t from public.general_tasks where id=new.task_id for update;
        if exists(select 1 from public.general_projects where id=p and class_board_id is null) then
          if t.id is null or t.project_id<>p or t.routing_state<>'released'
             or t.archived_at is not null or t.trashed_at is not null then
            raise exception 'Send live work to a team before assigning it.' using errcode='check_violation';
          end if;
          select m.role into actor_role from public.general_members m
            join public.profiles pr on pr.id=m.user_id
            where m.project_id=p and m.user_id=auth.uid() and pr.status='active'
            for share of m,pr nowait;
          if not found then
            raise exception 'Your project membership changed. Reload and try again.' using errcode='insufficient_privilege';
          end if;
          perform 1 from public.general_members m join public.profiles pr on pr.id=m.user_id
            where m.project_id=p and m.user_id=new.user_id and pr.status='active'
              and m.role not in ('qa','stakeholder') for share of m,pr nowait;
          if not found then
            raise exception 'Choose an active project member who can hold tasks.' using errcode='check_violation';
          end if;
          if actor_role not in ('pm','coordinator') then
            perform 1 from public.general_teams g
              join public.general_team_members lead on lead.project_id=p and lead.team_id=g.id and lead.user_id=auth.uid()
              join public.general_team_members recipient on recipient.project_id=p and recipient.team_id=g.id and recipient.user_id=new.user_id
              where g.project_id=p and g.id=t.team_id and g.archived_at is null and g.leader_id=auth.uid()
              for share of g,lead,recipient nowait;
            if not found or actor_role='stakeholder' then
              raise exception 'Only the receiving team lead assigns its members. Reload and try again.' using errcode='insufficient_privilege';
            end if;
          end if;
        elsif not public.general_can(new.project_id, 'manage_tasks')
           and public.general_task_held(new.task_id) then
          raise exception 'Somebody already holds this task' using errcode='check_violation';
        end if;
      when 'general_task_comments'  then new.author_id := auth.uid();
      when 'general_task_files'     then new.uploaded_by := auth.uid();
      when 'general_task_logs'      then new.user_id := auth.uid();
      else null;
    end case;
  elsif tg_op = 'UPDATE' and tg_table_name = 'general_task_comments' then
    new.author_id := old.author_id;
    new.task_id := old.task_id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- ---------------------------------------------------------------- invitations and joining
-- Invitations carry a role. The space project manager and coordinators invite; a
-- coordinator invite comes from the project manager only. Work spaces have one project
-- manager, so there are no co-owner invitations.
create or replace function public.general_space_manages_invites(p_space uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.general_space_has_invite(p_space);
$function$;

drop function if exists public.invite_general_space_member(uuid, uuid);
create or replace function public.invite_general_space_member(
  p_space uuid,
  p_user  uuid,
  p_role  public.general_role default 'member'
) returns public.general_space_invitations
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inv public.general_space_invitations%rowtype;
begin
  if not public.general_space_has_invite(p_space) then
    raise exception 'You need permission to invite people to this space. Ask the project manager or a coordinator to send it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_education_space(p_space) then
    raise exception 'This invitation is for a work space. Use the class invitation instead.'
      using errcode = 'check_violation';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'coordinator' and not exists (
       select 1 from public.general_space_members
        where space_id = p_space and user_id = auth.uid() and role = 'pm') then
    raise exception 'Only the project manager can invite a coordinator.'
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
  insert into public.general_space_invitations (space_id, invitee, invited_by, invited_level, invited_role)
  values (p_space, p_user, auth.uid(), 'member', p_role)
  returning * into inv;
  return inv;
end;
$function$;
revoke all on function public.invite_general_space_member(uuid, uuid, public.general_role) from public, anon;
grant execute on function public.invite_general_space_member(uuid, uuid, public.general_role) to authenticated, service_role;

create or replace function public.invite_to_general_space(p_space uuid, p_user uuid)
 returns public.general_space_invitations
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    raise exception 'A space has one project manager. Use Hand over instead.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'no_data_found';
  end if;
  if exists (
       select 1 from public.general_space_members
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
$function$;

create or replace function public.respond_general_space_invitation(p_invitation uuid, p_accept boolean)
 returns public.general_space_invitations
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
     and inv.invited_level = 'owner'
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
    -- Joining a space sets no role on projects the person already holds.
    insert into public.general_space_members (space_id, user_id, role)
    values (inv.space_id, auth.uid(), inv.invited_role)
    on conflict do nothing;
  end if;
  return inv;
end;
$function$;

create or replace function public.join_general_project(p_code text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p public.general_projects%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a project'
      using errcode = 'insufficient_privilege';
  end if;
  -- No student refusal any more (the copy in company-accounts.sql had one).
  -- A student joins a work project by its code like anybody else, as a
  -- member (or with the role a pending invitation holds), and the project
  -- manager can change the role afterwards. Spaces are another matter:
  -- join_general_space keeps its own rules.

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

  -- A pending invitation's role wins: only the project manager can have made
  -- it coordinator, and the code should not undo that. Never pm. Without one,
  -- the person's space role applies (the space pm reads as coordinator).
  insert into public.general_members (project_id, user_id, role)
  values (p.id, auth.uid(), coalesce(
    (select i.role from public.general_invitations i
      where i.project_id = p.id and i.invitee = auth.uid() and i.status = 'pending'
        and i.role <> 'pm'
      order by i.created_at desc limit 1),
    public.general_space_default_role(p.id, auth.uid()),
    'member'))
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$function$;

create or replace function public.invite_to_general_project(p_project uuid, p_user uuid, p_role public.general_role default 'member')
 returns public.general_invitations
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inv public.general_invitations%rowtype;
  i_am_pm boolean := public.general_role_of(p_project, auth.uid()) is not distinct from 'pm';
begin
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to invite people to this project'
      using errcode = 'insufficient_privilege';
  end if;
  -- Every role but pm can be invited; only the pm invites a coordinator, unless
  -- the person is already a coordinator of the space. QA is on since phase 4:
  -- the pm and a coordinator both invite as qa, and the invitee holds no tasks
  -- once they join (guard_general_task_child).
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'coordinator' and not i_am_pm
     and public.general_space_default_role(p_project, p_user) is distinct from 'coordinator' then
    raise exception 'Only the project manager can invite a coordinator.'
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
    -- Already invited, and inviting again is not an error. The pm may change
    -- the role it carries; anyone else gets it back as it stands.
    if i_am_pm and inv.role is distinct from p_role then
      update public.general_invitations set role = p_role where id = inv.id
      returning * into inv;
    end if;
    return inv;
  end if;

  perform public.rate_limit('general_invite', 100, interval '1 hour',
    'You have sent a lot of invitations in the last hour. Try again later.');

  -- The invitee joins with this role when they accept or join by code.
  insert into public.general_invitations (project_id, invitee, invited_by, role)
  values (p_project, p_user, auth.uid(), p_role)
  returning * into inv;
  return inv;
end;
$function$;

-- create_general_project, eight-argument form, as live. Only the team seed changes: it
-- takes each person's space role. The creator row is inserted above it and stays.
create or replace function public.create_general_project(p_name text, p_description text default ''::text, p_starts_on date default null::date, p_ends_on date default null::date, p_preset text default null::text, p_content jsonb default null::jsonb, p_space uuid default null::uuid, p_space_team uuid default null::uuid)
 returns public.general_projects
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

    insert into public.general_members (project_id, user_id, role)
    select p.id, tm.user_id,
           case when tm.user_id = auth.uid() then 'pm'::public.general_role
                else coalesce(public.general_space_default_role(p.id, tm.user_id), 'member'::public.general_role)
           end
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
$function$;

commit;
