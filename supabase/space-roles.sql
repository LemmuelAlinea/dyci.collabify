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

commit;
