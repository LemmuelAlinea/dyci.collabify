-- Collabify — company roles, phase 2: project roles.
--
--   node scripts/db.mjs supabase/project-roles.sql supabase/anon-lockdown.sql
--
-- Each person in a work project holds one role:
--
--   pm           the project manager, exactly one          (was Owner)
--   coordinator  runs the project with the pm              (was Manager)
--   member       today's member rules, plus grants         (was Member)
--   qa           phase 4; holds no permission yet
--   stakeholder  phase 3; holds no permission yet
--
-- `role` is the source of truth. `level` stays, kept in step by a trigger
-- (pm -> owner, coordinator -> manager, everyone else -> member), so every older
-- check that reads `level` keeps working, and so do older callers that write
-- it. Class-board Files projects (`class_board_id` set) keep the old model:
-- their rows are all `member` by role and `level` is theirs alone.
--
-- Runs after company-accounts.sql and everything else in docs/07-backup.md, and
-- redefines from their latest (live) copies: general_has and general_can_grant
-- (general.sql), guard_student_level and join_general_project
-- (company-accounts.sql), and the general_members_student_level trigger
-- (access.sql); invite_to_general_project, respond_general_invitation,
-- remove_general_member, leave_general_project, grant_general_permission and
-- answer_general_access_request (general.sql); log_general_member_change and
-- the general_project_events kinds (general-reports.sql);
-- notify_general_membership (class-files.sql) and the
-- general_members_notify_level trigger (notification-coverage.sql). It drops
-- general.sql's set_general_member_level. Re-run it after re-running any of
-- access.sql, company-accounts.sql, general.sql, general-reports.sql,
-- notification-coverage.sql or class-files.sql, then anon-lockdown.sql. It also
-- redefines general_project_overview (general-project-space.sql) and
-- list_general_project_members (one-workplace.sql) with the role columns added.
-- project-visibility.sql and project-team-leads.sql run after it and redefine
-- some of what it defines, so re-run those two after it, in that order.
--
-- Idempotent. Safe to re-run.

-- A new enum cannot be used in the transaction that creates it in every case
-- (and `add value` never can). db.mjs sends the whole file as one query, and a
-- bare statement before `begin;` would join that transaction, so the type
-- commits in its own block first.
begin;
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'general_role') then
    create type public.general_role as enum ('pm', 'coordinator', 'member', 'qa', 'stakeholder');
  end if;
end $$;
commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_members
  add column if not exists role public.general_role not null default 'member';
alter table public.general_invitations
  add column if not exists role public.general_role not null default 'member';

comment on column public.general_members.role is
  'The person''s role in a work project. level follows it (sync_general_member_level). '
  'Class-board Files projects keep level and leave this at member.';
comment on column public.general_invitations.role is
  'The role the invitee joins a work project with.';

-- ---------------------------------------------------------------- level sync

/** The old level a role sits at: pm -> owner, coordinator -> manager, else member. */
create or replace function public.general_role_level(r public.general_role)
returns public.general_level language sql immutable set search_path = public as $$
  select case r
    when 'pm' then 'owner'
    when 'coordinator' then 'manager'
    else 'member'
  end::public.general_level;
$$;

/**
 * The role a work-project row ends up with once the sync trigger has run.
 * Shared by the sync trigger and the student guard, which fires first.
 *
 * The role wins whenever the caller changed it. Older callers write only
 * `level`:
 *   - an INSERT that leaves role at its default with level owner/manager gets
 *     pm/coordinator (create_general_project, space-team seeding);
 *   - an UPDATE that changes level and leaves role alone gets the role for
 *     that level. That includes an UPDATE that sets role to the value it
 *     already had: role is unchanged, so the new level wins.
 */
create or replace function public.general_member_role_for(
  p_insert    boolean,
  p_role      public.general_role,
  p_level     public.general_level,
  p_old_role  public.general_role,
  p_old_level public.general_level
) returns public.general_role language sql immutable set search_path = public as $$
  select case
    when p_insert and p_role = 'member' and p_level = 'owner' then 'pm'
    when p_insert and p_role = 'member' and p_level = 'manager' then 'coordinator'
    when not p_insert and p_role is not distinct from p_old_role
         and p_level is distinct from p_old_level then
      case p_level when 'owner' then 'pm' when 'manager' then 'coordinator' else 'member' end
    else p_role::text
  end::public.general_role;
$$;

create or replace function public.sync_general_member_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.general_projects p
                  where p.id = new.project_id and p.class_board_id is null) then
    return new; -- a class-board Files project keeps the old model
  end if;
  if tg_op = 'INSERT' then
    new.role := public.general_member_role_for(true, new.role, new.level, null, null);
  else
    new.role := public.general_member_role_for(false, new.role, new.level, old.role, old.level);
  end if;
  new.level := public.general_role_level(new.role);
  return new;
end;
$$;

drop trigger if exists sync_general_member_level on public.general_members;
create trigger sync_general_member_level
  before insert or update of role, level on public.general_members
  for each row execute function public.sync_general_member_level();

-- ---------------------------------------------------------------- students

/**
 * company-accounts.sql's guard. On a work project's members a student may hold
 * any role but pm, whoever writes the row. Space members, space-team members
 * and class-board projects keep the old rule: a student is only a member, when
 * a signed-in person writes it.
 */
create or replace function public.guard_student_level()
returns trigger language plpgsql security definer set search_path = public as $$
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

  if auth.uid() is not null and new.level <> 'member' and public.is_student(new.user_id) then
    raise exception 'A student can only be a member. Owner and Manager are for members and teachers.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- access.sql's trigger, now also on a change of role.
drop trigger if exists general_members_student_level on public.general_members;
create trigger general_members_student_level
  before insert or update of level, role on public.general_members
  for each row execute function public.guard_student_level();

-- ---------------------------------------------------------------- migration

-- Work projects: owner -> pm, manager -> coordinator, member -> member. Where a
-- project has several Owners the creator stays pm (else the earliest to join)
-- and the others become coordinators. Only rows whose role does not match
-- their level are touched, so a re-run changes nothing, and a later qa or
-- stakeholder (level member) is never reset.
update public.general_members m
   set role = case
                when m.level = 'owner' and m.user_id = (
                  select o.user_id from public.general_members o
                   where o.project_id = m.project_id and o.level = 'owner'
                   order by (o.user_id = p.created_by) desc, o.joined_at, o.user_id
                   limit 1) then 'pm'
                when m.level in ('owner', 'manager') then 'coordinator'
                else 'member'
              end::public.general_role
  from public.general_projects p
 where p.id = m.project_id and p.class_board_id is null
   and m.level <> public.general_role_level(m.role);

-- Class-board rows are members by role; their level is left alone.
update public.general_members m
   set role = 'member'
  from public.general_projects p
 where p.id = m.project_id and p.class_board_id is not null and m.role <> 'member';

-- ---------------------------------------------------------------- one pm

create unique index if not exists general_members_one_pm
  on public.general_members (project_id) where role = 'pm';

-- ---------------------------------------------------------------- helpers

/**
 * The person's role in a project, or null when they are not an active member.
 * Answers only what the general_members rows already show the caller.
 */
create or replace function public.general_role_of(p_project uuid, p_user uuid default auth.uid())
returns public.general_role language sql stable security definer set search_path = public as $$
  select m.role
    from public.general_members m
    join public.profiles pr on pr.id = m.user_id
   where m.project_id = p_project
     and m.user_id = p_user
     and pr.status = 'active'
     and (auth.uid() is null or p_user = auth.uid()
          or coalesce(public.can_read_general_project(p_project), false));
$$;

/**
 * True when someone active, with Project manager on, is the project's pm.
 * Answers only somebody who can read the project (or an admin, or the service
 * role). Anyone else gets false, so it cannot be used to probe other projects.
 */
create or replace function public.general_project_has_pm(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_admin()
          or coalesce(public.can_read_general_project(p_project), false))
     and exists (
    select 1
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.role = 'pm'
       and pr.status = 'active'
       and pr.can_manage_projects
  );
$$;

-- ---------------------------------------------------------------- permissions

/**
 * Holds the permission, archived or not. For deciding what somebody may read.
 *
 * Work projects read the role: a pm holds all six, a coordinator all but
 * edit_project, a member only their grants, qa and stakeholder none.
 * Class-board Files projects keep general.sql's body unchanged: Owner or
 * Manager, a grant, or the class-board commit rule.
 */
create or replace function public.general_has(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.general_projects gp
                  where gp.id = p_project and gp.class_board_id is null) then
      coalesce(public.is_general_member(p_project) and (
        case public.general_role_of(p_project, auth.uid())
          when 'pm' then true
          when 'coordinator' then p_permission <> 'edit_project'
          when 'member' then exists (
            select 1 from public.general_grants g
             where g.project_id = p_project and g.user_id = auth.uid()
               and g.permission = p_permission
          )
          else false
        end
      ), false)
    else
      public.is_general_member(p_project) and (
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
        or (p_permission = 'commit_main' and public.general_class_commit_ok(p_project))
      )
  end;
$$;

/**
 * May give, take back and answer requests for this permission.
 *
 * Work projects: the pm gives every permission, and a coordinator every one it
 * holds itself, so all but edit_project. Nobody else gives anything, whatever
 * they were granted. Grants go to members only (grant_general_permission).
 * Class-board Files projects keep general.sql's body unchanged: an Owner, or
 * the group's leader for commit_main.
 */
create or replace function public.general_can_grant(p_project uuid, p_permission public.general_permission)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.general_projects gp
                  where gp.id = p_project and gp.class_board_id is null) then
      coalesce(public.is_general_member(p_project) and (
        case public.general_role_of(p_project, auth.uid())
          when 'pm' then true
          when 'coordinator' then p_permission <> 'edit_project'
          else false
        end
      ), false)
    else
      public.is_general_owner(p_project)
      or (p_permission = 'commit_main' and public.general_class_board_leads(p_project))
  end;
$$;

-- ---------------------------------------------------------------- join codes

/** company-accounts.sql's copy, now open to students too. They join as members. */
create or replace function public.join_general_project(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
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
  -- it coordinator, and the code should not undo that. Never pm.
  insert into public.general_members (project_id, user_id, role)
  values (p.id, auth.uid(), coalesce(
    (select i.role from public.general_invitations i
      where i.project_id = p.id and i.invitee = auth.uid() and i.status = 'pending'
        and i.role <> 'pm'
      order by i.created_at desc limit 1),
    'member'))
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$$;

-- ================================================================ setting roles
--
-- Who sets what, on a work project:
--   - the pm sets coordinator or member on anyone but themself, and hands over;
--   - a coordinator switches people among member (member, qa and stakeholder
--     once those open), and never touches a coordinator or the pm;
--   - qa and stakeholder are refused for now, and pm only moves by hand over.
-- Class-board Files projects keep their levels and the old bodies below.

-- ---------------------------------------------------------------- activity log

alter table public.general_project_events drop constraint if exists general_project_events_kind;
alter table public.general_project_events add constraint general_project_events_kind check (kind in (
  'task_archived', 'task_restored', 'project_status', 'project_archived',
  'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level',
  'member_role', 'pm_handover',
  -- project-team-leads.sql's kind, listed here too so re-running this file
  -- once team_leader events exist does not fail on them.
  'team_leader'));

/**
 * general-reports.sql's logger. A work project logs a change of role
 * (member_role, {from, to}) and no longer a change of level, which only
 * follows the role. hand_over_general_project writes one pm_handover in place
 * of its two role changes. Class-board Files projects log levels as before.
 */
create or replace function public.log_general_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
    values (new.project_id, auth.uid(), new.user_id, 'member_joined',
            jsonb_build_object('level', new.level));
    return new;
  elsif tg_op = 'UPDATE' then
    if exists (select 1 from public.general_projects p
                where p.id = new.project_id and p.class_board_id is null) then
      if new.role is distinct from old.role
         and coalesce(current_setting('collabify.pm_handover', true), 'off') <> 'on' then
        insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
        values (new.project_id, auth.uid(), new.user_id, 'member_role',
                jsonb_build_object('from', old.role, 'to', new.role));
      end if;
    elsif new.level is distinct from old.level then
      insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
      values (new.project_id, auth.uid(), new.user_id, 'member_level',
              jsonb_build_object('from', old.level, 'to', new.level));
    end if;
    return new;
  end if;

  -- A cascade from a deleted project or profile records nothing: the project
  -- is going, or the person is.
  if pg_trigger_depth() > 1
     or not exists (select 1 from public.general_projects where id = old.project_id) then
    return old;
  end if;
  insert into public.general_project_events (project_id, actor_id, subject_id, kind)
  values (old.project_id, auth.uid(), old.user_id,
          case when auth.uid() = old.user_id then 'member_left' else 'member_removed' end);
  return old;
end;
$$;

-- ---------------------------------------------------------------- notifications

/** What follows "You are now" when a work-project role changes. */
create or replace function public.general_role_phrase(p_role public.general_role)
returns text language sql immutable set search_path = public as $$
  select case p_role
    when 'pm' then 'the project manager'
    when 'coordinator' then 'a coordinator'
    when 'qa' then 'QA'
    when 'stakeholder' then 'a stakeholder'
    else 'a member'
  end;
$$;

/** class-files.sql's copy. A work project's member is told their new role. */
create or replace function public.notify_general_membership()
returns trigger language plpgsql security definer set search_path = public as $$
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
    msg := 'You are now ' || public.general_level_label(new.level);
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
$$;

-- notification-coverage.sql's trigger, now also on a change of role alone
-- (member to qa keeps level member).
drop trigger if exists general_members_notify_level on public.general_members;
create trigger general_members_notify_level after update of level, role on public.general_members
  for each row when (old.level is distinct from new.level or old.role is distinct from new.role)
  execute function public.notify_general_membership();

-- ---------------------------------------------------------------- set a role

create or replace function public.set_general_member_role(
  p_project uuid,
  p_user    uuid,
  p_role    public.general_role
) returns void language plpgsql security definer set search_path = public as $$
declare
  me     public.general_role;
  target public.general_members%rowtype;
begin
  if p_role in ('qa', 'stakeholder') then
    raise exception 'QA and stakeholder roles are not available yet.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;

  -- Class-board Files projects hold no pm or coordinator, so they stop here too.
  me := public.general_role_of(p_project, auth.uid());
  if me is null or me not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator changes roles.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- The pm's row, then the target's: the hand over locks in the same order.
  perform 1 from public.general_members
   where project_id = p_project and role = 'pm' for update;
  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;
  -- Asked again under the lock: a hand over may have moved the caller since.
  me := public.general_role_of(p_project, auth.uid());
  if me is null or me not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator changes roles.'
      using errcode = 'insufficient_privilege';
  end if;

  if me = 'coordinator' then
    if target.role not in ('member', 'qa', 'stakeholder') then
      raise exception 'Only the project manager can change a coordinator or the project manager.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_role = 'coordinator' then
      raise exception 'Only the project manager can make someone a coordinator.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif target.role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;

  if target.role = p_role then
    return;
  end if;

  update public.general_members set role = p_role
   where project_id = p_project and user_id = p_user;

  -- Grants are extras for members only, so anyone moved off member loses
  -- theirs and any open requests for more.
  if p_role <> 'member' then
    delete from public.general_grants where project_id = p_project and user_id = p_user;
    update public.general_access_requests
       set status = 'withdrawn', answered_at = now()
     where project_id = p_project and user_id = p_user and status = 'open';
  end if;
end;
$$;

-- ---------------------------------------------------------------- hand over

create or replace function public.hand_over_general_project(p_project uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
begin
  if public.general_role_of(p_project, auth.uid()) is distinct from 'pm' then
    raise exception 'Only the project manager can hand over the project.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_to = auth.uid() then
    raise exception 'You are already the project manager.' using errcode = 'check_violation';
  end if;

  perform 1 from public.general_members
   where project_id = p_project and role = 'pm' for update;
  -- Asked again under the lock, in case two hand overs raced.
  if not exists (select 1 from public.general_members
                  where project_id = p_project and user_id = auth.uid() and role = 'pm') then
    raise exception 'Only the project manager can hand over the project.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.general_members
   where project_id = p_project and user_id = p_to for update;
  if target.user_id is null then
    raise exception 'They are not on this project. Invite them first, then hand over.'
      using errcode = 'no_data_found';
  end if;
  if not public.is_project_manager(p_to) then
    raise exception 'Only someone with Project manager turned on can run a project.'
      using errcode = 'check_violation';
  end if;

  -- Demote first, then promote, so general_members_one_pm holds throughout.
  -- The two role changes are logged as one pm_handover below.
  perform set_config('collabify.pm_handover', 'on', true);
  update public.general_members set role = 'coordinator'
   where project_id = p_project and user_id = auth.uid();
  update public.general_members set role = 'pm'
   where project_id = p_project and user_id = p_to;
  perform set_config('collabify.pm_handover', 'off', true);

  delete from public.general_grants where project_id = p_project and user_id = p_to;
  update public.general_access_requests
     set status = 'withdrawn', answered_at = now()
   where project_id = p_project and user_id = p_to and status = 'open';

  insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
  values (p_project, auth.uid(), p_to, 'pm_handover',
          jsonb_build_object('from_user', auth.uid(), 'to_user', p_to));
end;
$$;

-- ---------------------------------------------------------------- PM recovery

/**
 * Gives a project with no pm (deactivated, or Project manager turned off) a new
 * one. Only an owner of the project's space or an admin, and only while
 * general_project_has_pm is false. Any leftover pm row becomes a coordinator,
 * and the new pm joins the project first if they were not on it.
 */
create or replace function public.assign_general_project_pm(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj public.general_projects%rowtype;
begin
  select * into proj from public.general_projects
   where id = p_project and class_board_id is null;

  if not public.general_viewer_active()
     or not (public.is_admin()
             or exists (select 1 from public.general_space_members sm
                         where sm.space_id = proj.space_id and sm.user_id = auth.uid()
                           and sm.level = 'owner')) then
    raise exception 'Only an owner of this project''s space or an admin can assign a project manager.'
      using errcode = 'insufficient_privilege';
  end if;
  if proj.id is null then
    raise exception 'That project was not found. Check the link or ask its project manager.'
      using errcode = 'no_data_found';
  end if;

  -- The project row first, so two assigns on a project with no pm row queue
  -- here instead of meeting at general_members_one_pm.
  perform 1 from public.general_projects where id = p_project for update;
  perform 1 from public.general_members
   where project_id = p_project and role = 'pm' for update;
  -- general_project_has_pm's rule, ungated: its read gate hides an archived
  -- project from a space owner who is not a lead, and would read as no pm.
  if exists (select 1
               from public.general_members m
               join public.profiles pr on pr.id = m.user_id
              where m.project_id = p_project and m.role = 'pm'
                and pr.status = 'active' and pr.can_manage_projects) then
    raise exception 'This project already has a project manager.'
      using errcode = 'check_violation';
  end if;
  if not public.is_project_manager(p_user) then
    raise exception 'Only someone with Project manager turned on can run a project.'
      using errcode = 'check_violation';
  end if;

  update public.general_members set role = 'coordinator'
   where project_id = p_project and role = 'pm' and user_id <> p_user;
  insert into public.general_members (project_id, user_id, role)
  values (p_project, p_user, 'member')
  on conflict do nothing;
  update public.general_members set role = 'pm'
   where project_id = p_project and user_id = p_user;

  delete from public.general_grants where project_id = p_project and user_id = p_user;
  update public.general_access_requests
     set status = 'withdrawn', answered_at = now()
   where project_id = p_project and user_id = p_user and status = 'open';
end;
$$;

-- ---------------------------------------------------------------- the old level RPC

-- general.sql's set_general_member_level is gone: the app sets roles with
-- set_general_member_role and moves the pm with hand_over_general_project.
-- general.sql still defines it, so re-running general.sql brings it back
-- until this file runs again, as the header says it must.
drop function if exists public.set_general_member_level(uuid, uuid, public.general_level);

-- ---------------------------------------------------------------- grants

/**
 * general.sql's copy. On a work project the refusals name the project manager
 * and coordinators (general_can_grant), and grants go to members only: not a
 * coordinator or the pm, who hold them already, and not QA or a stakeholder,
 * whose level is member but whose role is not.
 */
create or replace function public.grant_general_permission(
  p_project uuid, p_user uuid, p_permission public.general_permission)
returns void language plpgsql security definer set search_path = public as $$
declare
  lvl public.general_level;
  rl  public.general_role;
  is_work boolean := exists (select 1 from public.general_projects
                              where id = p_project and class_board_id is null);
begin
  if not public.general_can_grant(p_project, p_permission) then
    if is_work and public.general_role_of(p_project, auth.uid()) = 'coordinator' then
      raise exception 'Only the project manager gives Edit project details.'
        using errcode = 'insufficient_privilege';
    elsif is_work then
      raise exception 'Only the project manager or a coordinator gives permissions.'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Only an Owner grants permissions' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level, role into lvl, rl from public.general_members
   where project_id = p_project and user_id = p_user;
  if lvl is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;
  if lvl <> 'member' then
    raise exception '%', case when is_work
                          then 'The project manager and coordinators already hold every permission'
                          else 'Owners and Managers already hold every permission' end
      using errcode = 'check_violation';
  end if;
  if is_work and rl <> 'member' then
    raise exception 'Grants are for members only.' using errcode = 'check_violation';
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

/**
 * general.sql's copy. Approving gives the grant only to someone whose role is
 * member, so on a work project not to QA or a stakeholder.
 */
create or replace function public.answer_general_access_request(
  p_request uuid, p_approve boolean, p_note text default '')
returns public.general_access_requests
language plpgsql security definer set search_path = public as $$
declare
  req public.general_access_requests%rowtype;
  lvl public.general_level;
  rl  public.general_role;
begin
  select * into req from public.general_access_requests where id = p_request for update;
  if req.id is null or not public.general_can_grant(req.project_id, req.permission) then
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
    select level, role into lvl, rl from public.general_members
     where project_id = req.project_id and user_id = req.user_id;
    -- Class-board rows are all member by role, so this is the old rule there.
    if lvl = 'member' and rl = 'member' then
      insert into public.general_grants (project_id, user_id, permission, granted_by)
      values (req.project_id, req.user_id, req.permission, auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return req;
end;
$$;

-- ---------------------------------------------------------------- inviting

-- The two-argument copy goes, so an old two-argument call resolves to this one
-- through the default and is never ambiguous.
drop function if exists public.invite_to_general_project(uuid, uuid);

/** general.sql's copy, plus the role the invitee joins with. */
create or replace function public.invite_to_general_project(
  p_project uuid,
  p_user    uuid,
  p_role    public.general_role default 'member'
) returns public.general_invitations language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
  i_am_pm boolean := public.general_role_of(p_project, auth.uid()) is not distinct from 'pm';
begin
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to invite people to this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_role in ('qa', 'stakeholder') then
    raise exception 'QA and stakeholder roles are not available yet.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'coordinator' and not i_am_pm then
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

  insert into public.general_invitations (project_id, invitee, invited_by, role)
  values (p_project, p_user, auth.uid(), p_role)
  returning * into inv;
  return inv;
end;
$$;

/** general.sql's copy. The invitee joins with the role the invitation holds. */
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
    insert into public.general_members (project_id, user_id, role)
    values (inv.project_id, auth.uid(), inv.role)
    on conflict do nothing;
  end if;
  return inv;
end;
$$;

-- ---------------------------------------------------------------- removing, leaving

/**
 * general.sql's copy. On a work project the pm cannot be removed (hand over
 * first) and only the pm removes a coordinator. Class-board Files projects keep
 * the Owner rules.
 */
create or replace function public.remove_general_member(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
  owners int;
  is_work boolean := exists (select 1 from public.general_projects
                              where id = p_project and class_board_id is null);
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

  if is_work then
    if target.role = 'pm' then
      raise exception 'Hand over the project before removing its project manager.'
        using errcode = 'check_violation';
    end if;
    if target.role = 'coordinator'
       and public.general_role_of(p_project, auth.uid()) is distinct from 'pm' then
      raise exception 'Only the project manager removes a coordinator.'
        using errcode = 'insufficient_privilege';
    end if;
  else
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
  end if;

  delete from public.general_members where project_id = p_project and user_id = p_user;
end;
$$;

/** general.sql's copy. On a work project the pm hands over before leaving. */
create or replace function public.leave_general_project(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.general_members%rowtype;
  owners int;
  is_work boolean := exists (select 1 from public.general_projects
                              where id = p_project and class_board_id is null);
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

  if is_work then
    if me.role = 'pm' then
      raise exception 'Hand over the project before you leave.' using errcode = 'check_violation';
    end if;
  elsif me.level = 'owner' then
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

-- ---------------------------------------------------------------- readers

/**
 * general_project_overview gains my_role and has_pm at the end, so the page
 * can tell a project that lost its manager from one that has none to give.
 * Redefined from general-project-space.sql, the last file to own it; re-run
 * this file after re-running that one.
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
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset,
       p.has_code,
       p.space_id,
       s.name as space_name,
       m.role as my_role,
       public.general_project_has_pm(p.id) as has_pm
  from public.general_projects p
  left join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join public.general_spaces s on s.id = p.space_id
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id and x.archived_at is null
  ) t on true;

grant select on public.general_project_overview to authenticated;

/**
 * list_general_project_members gains role at the end. Redefined from
 * one-workplace.sql; re-run this file after re-running that one.
 */
drop function if exists public.list_general_project_members(uuid);
create function public.list_general_project_members(p_project uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text,
               level public.general_level, joined_at timestamptz, is_student boolean,
               role public.general_role)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_read_general_project(p_project) then
    raise exception 'You cannot see this project' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student', m.role
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

revoke execute on function public.list_general_project_members(uuid) from public, anon;
grant execute on function public.list_general_project_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- picking a pm

/**
 * search_general_people (general.sql), narrowed to people who have Project
 * manager turned on: the picker for a project's new pm
 * (assign_general_project_pm) and for a work space's co-owners
 * (invite_to_general_space). Same columns, and still no email unless the
 * search was that exact address. The caller is included, so a space owner can
 * pick themself. Only somebody who can use the answer asks: an admin, a space
 * owner, or someone with Project manager on (who owns the spaces they create).
 */
create or replace function public.search_project_managers(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to search'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.is_admin()
          or public.is_project_manager(auth.uid())
          or exists (select 1 from public.general_space_members sm
                      where sm.user_id = auth.uid() and sm.level = 'owner')) then
    raise exception 'Only space owners and admins can search for project managers.'
      using errcode = 'insufficient_privilege';
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
     where pr.role in ('member', 'admin')
       and pr.status = 'active'
       and pr.can_manage_projects
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

-- ---------------------------------------------------------------- admin list

/**
 * Every work project for the admin's Work projects page: its space, its pm's
 * name, whether it has a pm (general_project_has_pm's rule) and whether it is
 * archived. An admin reads no project rows through RLS, so the rows come from
 * this definer function, which answers an admin and nobody else. Class-board
 * Files projects and trashed projects are left out.
 */
create or replace function public.admin_work_project_rows()
returns table (id uuid, name text, space_name text, pm_name text, has_pm boolean,
               archived_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id,
         p.name,
         s.name,
         nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         coalesce(pr.status = 'active' and pr.can_manage_projects, false),
         p.archived_at
    from public.general_projects p
    left join public.general_spaces s on s.id = p.space_id
    left join public.general_members m on m.project_id = p.id and m.role = 'pm'
    left join public.profiles pr on pr.id = m.user_id
   where public.is_admin()
     and p.class_board_id is null
     and p.trashed_at is null;
$$;

revoke execute on function public.admin_work_project_rows() from public, anon;
grant execute on function public.admin_work_project_rows() to authenticated;

/** The page reads this view; security_invoker, so it is the caller asking. */
create or replace view public.admin_work_projects
with (security_invoker = true) as
select r.id, r.name, r.space_name, r.pm_name, r.has_pm, r.archived_at
  from public.admin_work_project_rows() r;

revoke all on public.admin_work_projects from public, anon;
grant select on public.admin_work_projects to authenticated;

-- ---------------------------------------------------------------- grants

grant execute on function public.set_general_member_role(uuid, uuid, public.general_role) to authenticated;
grant execute on function public.hand_over_general_project(uuid, uuid) to authenticated;
grant execute on function public.assign_general_project_pm(uuid, uuid) to authenticated;
grant execute on function public.invite_to_general_project(uuid, uuid, public.general_role) to authenticated;
grant execute on function public.search_project_managers(text) to authenticated;
grant execute on function public.grant_general_permission(uuid, uuid, public.general_permission) to authenticated;
grant execute on function public.answer_general_access_request(uuid, boolean, text) to authenticated;
grant execute on function public.respond_general_invitation(uuid, boolean) to authenticated;
grant execute on function public.remove_general_member(uuid, uuid) to authenticated;
grant execute on function public.leave_general_project(uuid) to authenticated;

commit;
