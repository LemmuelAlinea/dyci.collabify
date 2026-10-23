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
-- redefines from their latest (live) copies: general_has (general.sql),
-- guard_student_level and join_general_project (company-accounts.sql), and the
-- general_members_student_level trigger (access.sql). Re-run it after
-- re-running any of access.sql, company-accounts.sql or general.sql, then
-- anon-lockdown.sql.
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
 * The role wins whenever the caller set it. Older callers write only `level`:
 *   - an INSERT that leaves role at its default with level owner/manager gets
 *     pm/coordinator (create_general_project, space-team seeding);
 *   - an UPDATE that changes level and leaves role alone gets the role for
 *     that level (set_general_member_level, until it maps roles itself).
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

/** True when someone active, with Project manager on, is the project's pm. */
create or replace function public.general_project_has_pm(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
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
  -- member, and the project manager can change the role afterwards. Spaces
  -- are another matter: join_general_space keeps its own rules.

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

  insert into public.general_members (project_id, user_id, role)
  values (p.id, auth.uid(), 'member')
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$$;

commit;
