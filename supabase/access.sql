-- Collabify — admission-gated access. One workplace, phase 1.
--
--   node scripts/db.mjs supabase/access.sql
--
-- Nobody does anything until somebody admits them. The admin admits faculty
-- and says whether each one teaches. Faculty admit students, through a class
-- code or an invitation. A student can never make a space, and never walks into
-- a work space or a work-space project on a code.
--
-- The enum value is still 'professor'; the product calls it Faculty. The value
-- itself is renamed in phase 4, once the code that spells it has settled.
--
-- Runs last. Redefines, as supersets: handle_new_user (consent.sql,
-- workplaces.sql), guard_privileged_columns and guard_profile_insert
-- (workplaces.sql), log_profile_change (audit.sql), general_viewer_active and
-- join_general_project (general.sql), join_general_space (general-spaces.sql),
-- the professor_accounts view (admin-rename.sql), the classes_insert policy
-- (classes.sql) and set_account_role and set_account_active (accounts.sql).
-- Re-run this file after re-running any of those.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it, and the
-- audit trigger below uses it. So it commits on its own first.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'teaching_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- can_teach

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'can_teach'
  ) then
    alter table public.profiles add column can_teach boolean not null default false;
    -- Everybody who could run a class yesterday still can. Done only when the
    -- column is new, so a re-run never turns back on what the admin turned off.
    update public.profiles set can_teach = true where role = 'professor';
  end if;
end $$;

comment on column public.profiles.can_teach is
  'Set by the admin. Faculty with this on can open classes; without it, only work spaces.';

-- ---------------------------------------------------------------- helpers

/** Admitted faculty, and the admin. Pending and deactivated accounts are neither. */
create or replace function public.is_faculty(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role in ('professor', 'admin') and status = 'active'
  );
$$;

create or replace function public.is_student(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'student');
$$;

/** Faculty the admin has let open classes. */
create or replace function public.is_teaching_faculty(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role in ('professor', 'admin') and status = 'active' and can_teach
  );
$$;

/**
 * Whether the caller has been let in by anybody.
 *
 * Faculty are let in by the admin's approval. A student is let in by the first
 * class, space or project that takes them. No argument on purpose: nobody
 * needs to ask this about somebody else.
 */
create or replace function public.am_i_admitted()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active'
       and (
         p.role in ('professor', 'admin')
         or exists (select 1 from public.class_members m
                     where m.student_id = p.id and m.status = 'active')
         or exists (select 1 from public.general_space_members s where s.user_id = p.id)
         or exists (select 1 from public.general_members g where g.user_id = p.id)
       )
  );
$$;

grant execute on function public.am_i_admitted() to authenticated;

/**
 * General's read gate. It used to let a pending professor in, because General
 * needed no approval. Now nothing opens before approval, so an account waiting
 * on the admin reads nothing here either.
 */
create or replace function public.general_viewer_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'active' and role is not null
  );
$$;

-- ---------------------------------------------------------------- privilege guards

/**
 * Role, status and teaching are the admin's to set. The one exception this
 * used to carry — `enter_education` letting a role-less account pick a role
 * once — is gone with that function.
 */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.can_teach is distinct from old.can_teach)
     and not public.is_admin() then
    -- Pinned back rather than raised: a client that tries this is not owed an
    -- error message describing the rule it just failed to break.
    new.role := old.role;
    new.status := old.status;
    new.can_teach := old.can_teach;
  end if;
  return new;
end;
$$;

/**
 * Onboarding writes the profile row itself, and `profiles_insert_own` checks
 * nothing but the id. Every account now has to be a student or faculty from the
 * first row, and teaching is only ever granted by the admin.
 */
create or replace function public.guard_profile_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'You can only create your own profile'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is null or new.role not in ('student', 'professor') then
    raise exception 'Choose student or faculty to finish your profile'
      using errcode = 'check_violation';
  end if;
  new.status := case when new.role = 'professor' then 'pending' else 'active' end
                ::public.account_status;
  new.can_teach := false;
  return new;
end;
$$;

-- ---------------------------------------------------------------- signup

/**
 * The General branch is gone: registration asks for student or faculty and
 * nothing else. An account whose metadata names no role — Google, or an old
 * client still sending a workplace — gets no profile here and finishes on the
 * onboarding screen, which asks for a role.
 */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  resolved_role public.user_role;
  doc text;
  ver text;
begin
  -- Consent first, and outside the role check: see consent.sql.
  foreach doc in array array['privacy', 'terms'] loop
    ver := nullif(new.raw_user_meta_data ->> ('consent_' || doc), '');
    if ver is not null then
      if not exists (
        select 1 from public.legal_versions
         where document = doc and version = ver
      ) then
        raise exception
          'Consent to unpublished % version %. Add it to legal_versions in supabase/consent.sql.',
          doc, ver
          using errcode = 'foreign_key_violation';
      end if;

      insert into public.consent_records (user_id, document, version, surface)
      values (new.id, doc, ver, 'register')
      on conflict (user_id, document, version) do nothing;
    end if;
  end loop;

  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles
    (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'education'
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop function if exists public.enter_education(public.user_role);

-- ---------------------------------------------------------------- audit

/** audit.sql's trigger, plus the teaching switch. */
create or replace function public.log_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, after_value)
    values ('account_created', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            coalesce(new.role::text, 'none') || ' · ' || new.status::text);
    return new;
  end if;

  if new.role is distinct from old.role then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('role_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            coalesce(old.role::text, 'none'), coalesce(new.role::text, 'none'));
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('status_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            old.status::text, new.status::text);
  end if;

  if new.can_teach is distinct from old.can_teach then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('teaching_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            case when old.can_teach then 'teaching' else 'not teaching' end,
            case when new.can_teach then 'teaching' else 'not teaching' end);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- approval

drop function if exists public.decide_professor(uuid, boolean);

/**
 * Approve or turn down a faculty account, and optionally say whether it
 * teaches. `p_can_teach` null leaves teaching as it was, which is what a
 * turn-down or a second approval wants.
 */
create or replace function public.decide_faculty(
  p_user      uuid,
  p_approve   boolean,
  p_can_teach boolean default null
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  -- Through the API only the admin or the service role gets past here; an
  -- anonymous caller has no auth.uid() and must not slip through on that.
  -- A direct database session (SQL console, scripts, the test harness) keeps
  -- the old rule: a session impersonating a user must be the admin.
  if not public.is_admin()
     and (case when session_user = 'authenticator'
               then coalesce(auth.role(), '') <> 'service_role'
               else auth.uid() is not null end) then
    raise exception 'Only the program admin approves faculty accounts'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists'
      using errcode = 'no_data_found';
  end if;
  if target.role is distinct from 'professor' then
    raise exception 'Only faculty accounts go through approval'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set status     = case when p_approve then 'active' else 'rejected' end::public.account_status,
         can_teach  = coalesce(p_can_teach, can_teach),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

grant execute on function public.decide_faculty(uuid, boolean, boolean) to authenticated;

/** Turn teaching on or off for a faculty account after approval. */
create or replace function public.set_faculty_teaching(p_user uuid, p_can_teach boolean)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin()
     and (case when session_user = 'authenticator'
               then coalesce(auth.role(), '') <> 'service_role'
               else auth.uid() is not null end) then
    raise exception 'Only the program admin decides who teaches'
      using errcode = 'insufficient_privilege';
  end if;
  if p_can_teach is null then
    raise exception 'Choose whether this account can teach'
      using errcode = 'check_violation';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists'
      using errcode = 'no_data_found';
  end if;
  if target.role is distinct from 'professor' then
    raise exception 'Only faculty accounts can teach'
      using errcode = 'check_violation';
  end if;

  update public.profiles set can_teach = p_can_teach where id = p_user
  returning * into target;
  return target;
end;
$$;

grant execute on function public.set_faculty_teaching(uuid, boolean) to authenticated;

/** admin-rename.sql's view, with teaching on the end. Columns only ever append. */
create or replace view public.professor_accounts
with (security_invoker = true) as
select p.id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.email,
       p.avatar_url,
       p.status,
       p.created_at,
       p.decided_at,
       p.decided_by,
       btrim(d.first_name || ' ' || d.last_name) as decided_by_name,
       (select count(*) from public.classes c where c.professor_id = p.id)::int as class_count,
       p.can_teach
  from public.profiles p
  left join public.profiles d on d.id = p.decided_by
 where p.role = 'professor';

commit;

begin;

-- ---------------------------------------------------------------- who may create

/**
 * Spaces and projects are opened by faculty. A student's work lives in the
 * classes and spaces somebody let them into.
 *
 * A trigger rather than a check in each function: `create_general_space`,
 * `create_general_project` and every restore or duplicate path that inserts a
 * row all pass through here, including ones written after this file.
 */
create or replace function public.guard_general_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can create spaces and projects. Ask a faculty member to invite you to one.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_spaces_creator on public.general_spaces;
create trigger general_spaces_creator before insert on public.general_spaces
  for each row execute function public.guard_general_creator();

drop trigger if exists general_projects_creator on public.general_projects;
create trigger general_projects_creator before insert on public.general_projects
  for each row execute function public.guard_general_creator();

-- ---------------------------------------------------------------- student levels

/** Owner and Manager are faculty levels. A student is always a member. */
create or replace function public.guard_student_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.level <> 'member' and public.is_student(new.user_id) then
    raise exception 'A student can only be a member. Owner and Manager are for faculty.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_space_members_student_level on public.general_space_members;
create trigger general_space_members_student_level
  before insert or update of level on public.general_space_members
  for each row execute function public.guard_student_level();

drop trigger if exists general_members_student_level on public.general_members;
create trigger general_members_student_level
  before insert or update of level on public.general_members
  for each row execute function public.guard_student_level();

-- Space teams too: creating one makes its creator Owner, so this is also what
-- stops a student opening a team.
drop trigger if exists general_space_team_members_student_level on public.general_space_team_members;
create trigger general_space_team_members_student_level
  before insert or update of level on public.general_space_team_members
  for each row execute function public.guard_student_level();

-- ---------------------------------------------------------------- inviting students

/** A student comes into a work space only because a faculty member asked them. */
create or replace function public.guard_student_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and public.is_student(new.invitee)
     and not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can invite a student. Ask a faculty member to send the invitation.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_space_invitations_student on public.general_space_invitations;
create trigger general_space_invitations_student before insert on public.general_space_invitations
  for each row execute function public.guard_student_invite();

drop trigger if exists general_invitations_student on public.general_invitations;
create trigger general_invitations_student before insert on public.general_invitations
  for each row execute function public.guard_student_invite();

-- ---------------------------------------------------------------- joining by code

/** general-spaces.sql's version, refusing students before a guess is counted. */
create or replace function public.join_general_space(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a space'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_student(auth.uid()) then
    raise exception 'Students join classes with a class code. A faculty member can invite you to a space.'
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

/** general.sql's version, refusing students before a guess is counted. */
create or replace function public.join_general_project(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a project'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_student(auth.uid()) then
    raise exception 'Students join classes with a class code. A faculty member can invite you to a project.'
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

-- ---------------------------------------------------------------- opening a class

/** classes.sql's policy, plus teaching: approval alone no longer opens classes. */
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes
  for insert with check (
    professor_id = auth.uid() and public.is_teaching_faculty(auth.uid())
  );

commit;

begin;

-- ---------------------------------------------------------------- anonymous callers

/**
 * Every security-definer function below used to guard with
 * `auth.uid() is not null and not <allowed>`, which exists so the SQL console
 * and the test harness can call them without a JWT. An anonymous PostgREST
 * caller has no auth.uid() either, so it skipped the check.
 *
 * The admin functions now ask who is really on the line: through the API
 * (session_user is always 'authenticator' there) only the admin or the service
 * role passes. A direct database session keeps the old rule.
 *
 * set_account_role and set_account_active are accounts.sql's, copied with
 * only the guard changed. This file supersedes accounts.sql for them: re-run
 * it after accounts.sql.
 */
create or replace function public.set_account_role(
  p_user uuid,
  p_role public.user_role
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target  public.profiles%rowtype;
  holding int;
begin
  if not public.is_admin()
     and (case when session_user = 'authenticator'
               then coalesce(auth.role(), '') <> 'service_role'
               else auth.uid() is not null end) then
    raise exception 'Only the program admin changes an account''s role'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role = 'admin' then
    raise exception 'An admin is made from the command line, not from here'
      using errcode = 'check_violation';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role = 'admin' then
    raise exception 'An admin''s own role is not changed from here'
      using errcode = 'check_violation';
  end if;

  if target.id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  if target.role = p_role then
    return target; -- already there, and saying so twice is not an error
  end if;

  -- A class with no professor is unreachable to everybody. Hand it over first,
  -- which is the same reasoning that keeps delete off this page.
  if target.role = 'professor' and p_role = 'student' then
    select count(*) into holding from public.classes
     where professor_id = p_user and archived_at is null;
    if holding > 0 then
      raise exception
        'They still run % active %. Hand those over first, or archive them.',
        holding, case when holding = 1 then 'class' else 'classes' end
        using errcode = 'check_violation';
    end if;
  end if;

  update public.profiles
     set role = p_role,
         -- A new professor is unverified; a student needs no verifying.
         status = case when p_role = 'professor' then 'pending' else 'active' end
                  ::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

create or replace function public.set_account_active(
  p_user   uuid,
  p_active boolean
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin()
     and (case when session_user = 'authenticator'
               then coalesce(auth.role(), '') <> 'service_role'
               else auth.uid() is not null end) then
    raise exception 'Only the program admin deactivates an account'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role = 'admin' then
    raise exception 'An admin account is not deactivated from here'
      using errcode = 'check_violation';
  end if;

  if target.id = auth.uid() then
    raise exception 'You cannot deactivate yourself';
  end if;

  update public.profiles
     set status = case when p_active then 'active' else 'rejected' end
                  ::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

/**
 * Nobody signed out has any business calling these. The four admin functions
 * above, plus the class and board functions whose guards skip a null
 * auth.uid() the same way (classes, terms, results, reassignments). Revoking
 * is their fix; their bodies are unchanged.
 */
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.decide_faculty(uuid, boolean, boolean)',
    'public.set_faculty_teaching(uuid, boolean)',
    'public.set_account_role(uuid, public.user_role)',
    'public.set_account_active(uuid, boolean)',
    'public.apply_shift_to_deadlines(uuid, uuid[], uuid[])',
    'public.class_shift_impact(uuid)',
    'public.decide_reassignment(uuid, boolean, uuid, text)',
    'public.record_board_result(uuid, public.result_verdict, text)',
    'public.set_board_submitted(uuid, boolean)',
    'public.shift_class_weeks(uuid, integer, integer, text)',
    'public.withdraw_reassignment(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

commit;
