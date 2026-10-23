-- Collabify — company roles, phase 1: accounts.
--
--   node scripts/db.mjs supabase/company-accounts.sql supabase/anon-lockdown.sql
--
-- The Faculty account type is gone. An account is a student, a member or an
-- admin. A member is a plain account; the admin hands out two switches:
--
--   can_teach            (exists)  classes, class spaces, teaching.
--   can_manage_projects  (new)     making work spaces and work projects.
--
-- Students hold neither. Admins still do not teach, but may manage projects.
-- The `faculty` enum value stays in Postgres, and `profiles_no_faculty` makes
-- sure nothing writes it again.
--
-- Runs after access.sql, one-workplace.sql, class-files.sql and everything else
-- in docs/07-backup.md, and redefines from their latest copies: guard_privileged_
-- columns, guard_profile_insert, handle_new_user, log_profile_change,
-- is_teaching_faculty, teaches_in_space, class_teacher_ids, meeting_audience,
-- set_section_faculty, start_direct_conversation, start_direct_message,
-- am_i_admitted, guard_general_creator, guard_student_invite, search_faculty,
-- guard_student_level, join_general_project, join_general_space,
-- guard_class_space_member, guard_class_space_side, set_account_role,
-- set_faculty_teaching and the account_overview and professor_accounts views.
-- It drops is_faculty and decide_faculty. Re-run it after re-running any of
-- those files, then anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it. db.mjs sends
-- the whole file as one query, and a bare statement before `begin;` would join
-- that transaction, so the value commits in its own block first.
begin;
alter type public.user_role add value if not exists 'member';
commit;

begin;

-- ---------------------------------------------------------------- column

alter table public.profiles
  add column if not exists can_manage_projects boolean not null default false;

comment on column public.profiles.can_manage_projects is
  'Project manager: may create work spaces and work projects. Members and admins '
  'only, and only the admin sets it (profiles_guard_privileged).';

-- ---------------------------------------------------------------- guards

/** access.sql's guard, plus the Project manager switch. */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.can_teach is distinct from old.can_teach
      or new.can_manage_projects is distinct from old.can_manage_projects)
     and not public.is_admin() then
    -- Pinned back rather than raised: a client that tries this is not owed an
    -- error message describing the rule it just failed to break.
    new.role := old.role;
    new.status := old.status;
    new.can_teach := old.can_teach;
    new.can_manage_projects := old.can_manage_projects;
  end if;
  return new;
end;
$$;

/**
 * Onboarding writes the profile row itself. A student or a member, active at
 * once, and neither switch: those are only ever granted by the admin.
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
  if new.role is null or new.role not in ('student', 'member') then
    raise exception 'Choose student or member to finish your profile'
      using errcode = 'check_violation';
  end if;
  new.status := 'active';
  new.can_teach := false;
  new.can_manage_projects := false;
  return new;
end;
$$;

/** Sign-up. An old client sending `professor` or `faculty` gets a member. */
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

  if meta_role in ('professor', 'faculty') then
    meta_role := 'member';
  end if;

  if meta_role is null or meta_role not in ('student', 'member') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles
    (id, email, first_name, middle_name, last_name, role, status, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    'active',
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

/**
 * access.sql's audit trigger, plus the Project manager switch. It goes in as a
 * role change, because the admin's audit log already knows how to show one.
 */
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

  if new.can_manage_projects is distinct from old.can_manage_projects then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('role_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            case when old.can_manage_projects then 'project manager' else 'not project manager' end,
            case when new.can_manage_projects then 'project manager' else 'not project manager' end);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- migration

-- Runs as postgres, so auth.uid() is null and guard_privileged_columns lets it
-- through. Project manager first, while the faculty rows can still be found.
update public.profiles p
   set can_manage_projects = true
 where p.role = 'faculty'
   and not p.can_manage_projects
   and (exists (select 1
                  from public.general_space_members m
                  join public.general_spaces s on s.id = m.space_id
                 where m.user_id = p.id
                   and m.level in ('owner', 'manager')
                   and s.kind = 'work')
        or exists (select 1
                     from public.general_members gm
                     join public.general_projects gp on gp.id = gm.project_id
                    where gm.user_id = p.id
                      and gm.level in ('owner', 'manager')
                      and gp.class_board_id is null));

-- Status is untouched: a rejected account stays rejected.
update public.profiles set role = 'member' where role = 'faculty';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_no_faculty'
                    and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_no_faculty check (role is distinct from 'faculty');
  end if;
end $$;

-- Teaching now needs Can teach. Anyone seated to teach a class without it stops
-- teaching it, so the admin is told who, to turn Can teach on or take the seat
-- back. Admins seated as a non-teaching Manager are left as they are.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select btrim(p.first_name || ' ' || p.last_name) as who, p.status, m.level, s.name as space
      from public.general_space_members m
      join public.general_spaces s on s.id = m.space_id and s.kind = 'education'
      join public.profiles p on p.id = m.user_id
     where m.level in ('owner', 'manager')
       and p.role = 'member'
       and not p.can_teach
     order by p.last_name, p.first_name, s.name
  loop
    n := n + 1;
    raise notice 'Class seat without Can teach: % (%), % of "%"', r.who, r.status, r.level, r.space;
  end loop;
  if n = 0 then
    raise notice 'Class seat without Can teach: none';
  end if;
end $$;

-- ---------------------------------------------------------------- helpers

create or replace function public.is_teaching_faculty(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role = 'member' and status = 'active' and can_teach
  );
$$;

create or replace function public.is_project_manager(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role in ('member', 'admin') and status = 'active'
       and can_manage_projects
  );
$$;

grant execute on function public.is_project_manager(uuid) to authenticated;

create or replace function public.teaches_in_space(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_space_members m
      join public.profiles p on p.id = m.user_id
     where m.space_id = p_space
       and m.user_id = auth.uid()
       and m.level in ('owner', 'manager')
       and p.role = 'member' and p.can_teach
       and p.status = 'active'
  );
$$;

create or replace function public.class_teacher_ids(p_class uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.professor_id from public.classes c where c.id = p_class
  union
  select m.user_id
    from public.classes c
    join public.general_space_members m on m.space_id = c.space_id
    join public.profiles p on p.id = m.user_id
   where c.id = p_class
     and m.level in ('owner', 'manager')
     and p.role = 'member' and p.can_teach
     and p.status = 'active';
$$;

create or replace function public.meeting_audience(m public.meetings)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select cm.student_id as u from public.class_members cm
     where m.scope = 'class' and cm.class_id = m.class_id and cm.status = 'active'
    union all
    select c.professor_id from public.classes c where m.scope = 'class' and c.id = m.class_id
    union all
    select sm.user_id
      from public.classes c
      join public.general_space_members sm on sm.space_id = c.space_id
      join public.profiles pr on pr.id = sm.user_id
     where m.scope = 'class' and c.id = m.class_id
       and sm.level in ('owner', 'manager') and pr.role = 'member' and pr.can_teach
       and pr.status = 'active'
    union all
    select gm.student_id from public.group_members gm where m.scope = 'group' and gm.group_id = m.group_id
    union all
    select m.created_by where m.scope = 'group'
    union all
    select sm.user_id from public.general_space_members sm where m.scope = 'space' and sm.space_id = m.space_id
    union all
    select gm.user_id from public.general_members gm where m.scope = 'project' and gm.project_id = m.project_id
    union all
    select tm.user_id from public.general_space_team_members tm
     where m.scope = 'space_team' and tm.team_id = m.space_team_id
    union all
    select tm.user_id from public.general_team_members tm
     where m.scope = 'project_team' and tm.team_id = m.project_team_id
  ) x
  join public.profiles pr on pr.id = x.u
  where x.u is not null and pr.status <> 'rejected';
$$;

create or replace function public.set_section_faculty(p_section uuid, p_faculty uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  wanted uuid[] := coalesce(p_faculty, '{}');
  bad    int;
  n      int;
begin
  if not public.is_admin() then
    raise exception 'Only the program office assigns sections' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.program_sections where id = p_section and archived_at is null for update;
  if not found then
    raise exception 'That section is archived or no longer exists. Restore it from Archive first.'
      using errcode = 'check_violation';
  end if;

  select count(*) into bad
    from unnest(wanted) as w(id)
   where not exists (
     select 1 from public.profiles p
      where p.id = w.id and p.role = 'member' and p.status = 'active' and p.can_teach
   );
  if bad > 0 then
    raise exception 'Only active faculty who teach can be assigned a section'
      using errcode = 'check_violation';
  end if;

  delete from public.program_section_faculty
   where section_id = p_section and not (faculty_id = any (wanted));

  insert into public.program_section_faculty (section_id, faculty_id, assigned_by)
  select distinct p_section, w.id, auth.uid() from unnest(wanted) as w(id)
  on conflict (section_id, faculty_id) do nothing;

  select count(*) into n from public.program_section_faculty where section_id = p_section;
  return n;
end;
$$;

create or replace function public.start_direct_conversation(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  key   text;
  convo uuid;
begin
  if me is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if not exists (select 1 from public.profiles where id = me and role = 'member' and can_teach) then
    return jsonb_build_object('result', 'not_professor');
  end if;

  -- The student must actually be in one of the classes this person teaches.
  if not exists (
    select 1 from public.class_members m
     where m.student_id = p_student and m.status = 'active'
       and public.is_class_professor(m.class_id)
  ) then
    return jsonb_build_object('result', 'not_your_student');
  end if;

  key := least(me::text, p_student::text) || '|' || greatest(me::text, p_student::text);

  select id into convo from public.conversations where direct_key = key and kind = 'direct';
  if convo is null then
    insert into public.conversations (kind, direct_key) values ('direct', key)
    returning id into convo;
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, me), (convo, p_student);
  end if;

  return jsonb_build_object('result', 'ok', 'conversation_id', convo);
end;
$$;

create or replace function public.start_direct_message(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  convo uuid;
  existing uuid;
begin
  if me is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if not exists (select 1 from public.profiles where id = me and role = 'member' and can_teach) then
    return jsonb_build_object('result', 'not_professor');
  end if;

  if not exists (
    select 1 from public.classes c
    join public.class_members cm on cm.class_id = c.id
    where c.professor_id = me and cm.student_id = p_student and cm.status = 'active'
  ) then
    return jsonb_build_object('result', 'not_your_student');
  end if;

  select c.id into existing
    from public.conversations c
   where c.kind = 'direct'
     and c.direct_key = least(me, p_student) || ':' || greatest(me, p_student)
   limit 1;

  if existing is not null then
    return jsonb_build_object('result', 'ok', 'conversation_id', existing);
  end if;

  insert into public.conversations (kind, direct_key)
  values ('direct', least(me, p_student) || ':' || greatest(me, p_student))
  returning id into convo;

  insert into public.conversation_members (conversation_id, user_id) values
    (convo, me),
    (convo, p_student);

  return jsonb_build_object('result', 'ok', 'conversation_id', convo);
end;
$$;

create or replace function public.am_i_admitted()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active'
       and (
         p.role in ('member', 'admin')
         or exists (select 1 from public.class_members m
                     where m.student_id = p.id and m.status = 'active')
         or exists (select 1 from public.general_space_members s where s.user_id = p.id)
         or exists (select 1 from public.general_members g where g.user_id = p.id)
       )
  );
$$;

-- ---------------------------------------------------------------- who may create

/**
 * class-files.sql's guard. A class space, or a project inside one, needs Can
 * teach. Everything else needs Project manager. The class-board Files repo
 * still steps past it.
 */
create or replace function public.guard_general_creator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  edu boolean;
begin
  -- Checked table by table: NEW has no class_board_id on general_spaces.
  if current_setting('collabify.class_board_repo', true) = 'on' then
    if tg_table_name = 'general_spaces' then
      return new;
    elsif to_jsonb(new) ->> 'class_board_id' is not null then
      return new;
    end if;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'general_spaces' then
    edu := (to_jsonb(new) ->> 'kind') = 'education';
  else
    edu := exists (select 1 from public.general_spaces s
                    where s.id = (to_jsonb(new) ->> 'space_id')::uuid
                      and s.kind = 'education');
  end if;

  if edu then
    if not public.is_teaching_faculty(auth.uid()) then
      raise exception 'Only teachers can create class spaces.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not public.is_project_manager(auth.uid()) then
    raise exception 'Only project managers can create work spaces and projects. Ask a project manager to invite you.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.guard_student_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and public.is_student(new.invitee)
     and not (public.is_project_manager(auth.uid()) or public.is_teaching_faculty(auth.uid())) then
    raise exception 'Only project managers and teachers can invite a student.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

/** The co-teacher picker: active members who teach. */
create or replace function public.search_faculty(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if not (public.is_project_manager(auth.uid())
          or public.is_teaching_faculty(auth.uid())
          or public.is_admin()) then
    raise exception 'Only project managers and teachers can look up teachers'
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
     where pr.status = 'active'
       and pr.role = 'member' and pr.can_teach
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

create or replace function public.guard_student_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.level <> 'member' and public.is_student(new.user_id) then
    raise exception 'A student can only be a member. Owner and Manager are for members and teachers.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

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
    raise exception 'Students join classes with a class code. A project manager can invite you to a project.'
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
    raise exception 'Students join classes with a class code. A project manager can invite you to a space.'
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

create or replace function public.guard_class_space_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid := case when tg_op = 'DELETE' then old.space_id else new.space_id end;
  prof uuid;
begin
  -- Before the sync/service bypass, so the rule holds however the row arrives.
  if tg_op = 'INSERT' and public.is_education_space(sid)
     and not public.is_student(new.user_id) and new.level = 'member' then
    new.level := 'manager';
  end if;

  if auth.uid() is null or public.class_syncing() or not public.is_education_space(sid) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select professor_id into prof from public.classes where space_id = sid;

  if tg_op = 'INSERT' and public.is_student(new.user_id) then
    raise exception 'Students join a class with its class code.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and public.is_student(old.user_id) then
    raise exception 'Remove a student from the class roster instead.'
      using errcode = 'check_violation';
  end if;
  if (tg_op = 'DELETE' and old.user_id = prof)
     or (tg_op = 'UPDATE' and old.user_id = prof and new.level <> 'owner') then
    raise exception 'The class''s professor stays its Owner. Ask the program admin to hand the class to someone else.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and not public.is_student(new.user_id) and new.level = 'member' then
    raise exception 'Teachers in a class are Owner or Manager. Remove them instead.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.user_id <> auth.uid() and not public.is_general_space_owner(sid) then
    raise exception 'Only the class''s Owner removes teachers.' using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.guard_class_space_side()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.class_syncing()
     or new.space_id is null or not public.is_education_space(new.space_id) then
    return new;
  end if;

  if tg_table_name = 'general_space_invitations' then
    if public.is_student(new.invitee) then
      raise exception 'Students join a class with its class code.'
        using errcode = 'check_violation';
    end if;
    if not public.is_general_space_owner(new.space_id) then
      raise exception 'Only the class''s Owner invites teachers.' using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'general_space_join_codes' then
    raise exception 'A class uses its class code. Share that instead.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'general_projects' then
    raise exception 'Make class projects from the class itself.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop function if exists public.is_faculty(uuid);

-- ---------------------------------------------------------------- admin

/**
 * Live work projects a person runs: Owner of a project outside any class board.
 * Security definer because the admin cannot read projects they are not on, and
 * account_overview needs the number. So it answers only the admin, the person
 * themselves, and a session with no user (the service role, the SQL console).
 */
create or replace function public.managed_project_count(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.general_members gm
    join public.general_projects gp on gp.id = gm.project_id
   where gm.user_id = p_user
     and gm.level = 'owner'
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and (auth.uid() is null or auth.uid() = p_user or public.is_admin());
$$;

revoke execute on function public.managed_project_count(uuid) from public, anon;
grant execute on function public.managed_project_count(uuid) to authenticated;

/** A seat that teaches: a class they run, or Owner/Manager of a live class space. */
create or replace function public.holds_class_seat(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c
                  where c.professor_id = p_user and c.archived_at is null)
      or exists (select 1
                   from public.general_space_members m
                   join public.general_spaces s on s.id = m.space_id
                  where m.user_id = p_user
                    and m.level in ('owner', 'manager')
                    and s.kind = 'education'
                    and s.archived_at is null);
$$;

revoke execute on function public.holds_class_seat(uuid) from public, anon, authenticated;

/**
 * Student or member. Nobody becomes faculty, and nobody becomes admin from
 * here. Status is left alone. A member keeps their classes and projects until
 * they hand them over, and a student holds neither switch.
 */
create or replace function public.set_account_role(p_user uuid, p_role public.user_role)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
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
  if p_role is null or p_role not in ('student', 'member') then
    raise exception 'An account is a student or a member. Choose one of those.'
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

  -- A class or a project with nobody running it is unreachable to everybody in
  -- it. Hand it over first, which is the same reasoning that keeps delete off
  -- this page.
  if p_role = 'student'
     and (exists (select 1 from public.classes
                   where professor_id = p_user and archived_at is null)
          or (target.can_teach and public.holds_class_seat(p_user))
          or public.managed_project_count(p_user) > 0) then
    raise exception 'Hand over their classes and projects first.'
      using errcode = 'check_violation';
  end if;

  -- Status is left as it is. A role change used to make new faculty pending;
  -- sign-up no longer leaves anyone waiting, so there is nothing to verify.
  update public.profiles
     set role = p_role,
         can_teach = case when p_role = 'student' then false else can_teach end,
         can_manage_projects = case when p_role = 'student' then false else can_manage_projects end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

grant execute on function public.set_account_role(uuid, public.user_role) to authenticated;

create or replace function public.set_faculty_teaching(p_user uuid, p_can_teach boolean)
returns public.profiles language plpgsql security definer set search_path = public as $$
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
  if target.role is distinct from 'member' then
    raise exception 'Only members can teach.'
      using errcode = 'check_violation';
  end if;

  if not p_can_teach and target.can_teach and public.holds_class_seat(p_user) then
    raise exception 'They still teach a class. Hand it over or remove them from it first.'
      using errcode = 'check_violation';
  end if;

  update public.profiles set can_teach = p_can_teach where id = p_user
  returning * into target;
  return target;
end;
$$;

grant execute on function public.set_faculty_teaching(uuid, boolean) to authenticated;

create or replace function public.set_project_manager(p_user uuid, p_on boolean)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin()
     and (case when session_user = 'authenticator'
               then coalesce(auth.role(), '') <> 'service_role'
               else auth.uid() is not null end) then
    raise exception 'Only the program admin decides who manages projects'
      using errcode = 'insufficient_privilege';
  end if;
  if p_on is null then
    raise exception 'Choose whether this account manages projects'
      using errcode = 'check_violation';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists'
      using errcode = 'no_data_found';
  end if;
  if target.role is null or target.role not in ('member', 'admin') then
    raise exception 'Students cannot be project managers.'
      using errcode = 'check_violation';
  end if;

  if not p_on and public.managed_project_count(p_user) > 0 then
    raise exception 'They still run a project. Hand it over first.'
      using errcode = 'check_violation';
  end if;

  update public.profiles set can_manage_projects = p_on where id = p_user
  returning * into target;
  return target;
end;
$$;

grant execute on function public.set_project_manager(uuid, boolean) to authenticated;

-- Professor approvals is retired: sign-up no longer produces a pending account.
drop function if exists public.decide_faculty(uuid, boolean, boolean);

/** accounts.sql's view, plus both switches and the projects a person runs. */
drop view if exists public.account_overview;

create view public.account_overview
with (security_invoker = true) as
select p.id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.email,
       p.avatar_url,
       p.role,
       p.status,
       p.created_at,
       p.decided_at,
       p.decided_by,
       btrim(d.first_name || ' ' || d.last_name) as decided_by_name,
       (select count(*) from public.classes c
         where c.professor_id = p.id and c.archived_at is null)::int as class_count,
       (select count(*) from public.class_members m
         where m.student_id = p.id and m.status = 'active')::int as enrolment_count,
       p.can_teach,
       p.can_manage_projects,
       public.managed_project_count(p.id) as managed_project_count
  from public.profiles p
  left join public.profiles d on d.id = p.decided_by;

grant select on public.account_overview to authenticated;

/** access.sql's view, now the members who teach. Columns only ever append. */
drop view if exists public.professor_accounts;

create view public.professor_accounts
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
 where p.role = 'member' and p.can_teach;

grant select on public.professor_accounts to authenticated;

commit;
