-- Collabify — one workplace, phase 2: every class is a space.
--
--   node scripts/db.mjs supabase/one-workplace.sql
--
-- A class keeps being the thing a professor creates, edits, archives and
-- deletes. What changes is that it now owns a space of kind 'education', and
-- the space follows it: its name, archive state, Owner and roster are written by
-- the class, never directly. The class's own tables (groups, projects, syllabus
-- weeks, submissions) are untouched; the space is where membership, levels and
-- positions live, the same way they do for a work space.
--
-- Runs after access.sql. Redefines, as supersets: the general_space_overview
-- view (general-spaces.sql), join_class (rate-limit.sql), is_class_professor and
-- the classes_select/classes_update policies (classes.sql), is_set_professor
-- (groups.sql), is_project_professor (projects.sql), is_board_professor
-- (tasks.sql), shares_class_with (removed-visible.sql), can_read_syllabus
-- (syllabus.sql), can_moderate_conversation and start_direct_conversation
-- (messages.sql), list_general_space_members and list_general_project_members
-- (general-spaces.sql). Re-run this file after re-running any of those.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- kind

do $$ begin
  create type public.space_kind as enum ('work', 'education');
exception when duplicate_object then null; end $$;

alter table public.general_spaces
  add column if not exists kind public.space_kind not null default 'work';

comment on column public.general_spaces.kind is
  'education: the space of one class, written only by the class. work: everything else.';

-- ---------------------------------------------------------------- the class's space

alter table public.classes
  add column if not exists space_id uuid references public.general_spaces (id) on delete restrict;

alter table public.classes
  add column if not exists student_cap int;

do $$ begin
  alter table public.classes add constraint classes_student_cap_sane
    check (student_cap is null or student_cap between 1 and 500);
exception when duplicate_object then null; end $$;

comment on column public.classes.student_cap is
  'Most active students the class takes. Null is no limit. join_class enforces it.';

create unique index if not exists classes_space_key on public.classes (space_id);

-- ---------------------------------------------------------------- the sync flag

/**
 * Raised while a class writes its own space, so the guards on the space step
 * aside for it and for nobody else. Transaction-local, and restored to what it
 * was rather than switched off, so one sync running inside another does not
 * open the door early for the rest of the outer one.
 */
create or replace function public.class_sync_on()
returns text language plpgsql as $$
declare
  prev text := coalesce(current_setting('collabify.class_sync', true), 'off');
begin
  perform set_config('collabify.class_sync', 'on', true);
  return prev;
end;
$$;

create or replace function public.class_sync_restore(p_prev text)
returns void language plpgsql as $$
begin
  perform set_config('collabify.class_sync', coalesce(p_prev, 'off'), true);
end;
$$;

create or replace function public.class_syncing()
returns boolean language sql stable as $$
  select coalesce(current_setting('collabify.class_sync', true), 'off') = 'on';
$$;

-- Only the triggers below raise the flag. Nobody calls these over the API.
revoke execute on function public.class_sync_on() from public, anon, authenticated;
revoke execute on function public.class_sync_restore(text) from public, anon, authenticated;

create or replace function public.class_space_name(p_name text, p_section text)
returns text language sql immutable as $$
  select left(btrim(p_name) || ' · ' || btrim(p_section), 80);
$$;

-- ---------------------------------------------------------------- creating a class

/** Before the class row lands: make its space and seat the professor as Owner. */
create or replace function public.class_space_create()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  if new.space_id is not null then
    raise exception 'A class makes its own space' using errcode = 'check_violation';
  end if;

  prev := public.class_sync_on();
  insert into public.general_spaces (name, description, created_by, kind, archived_at)
  values (public.class_space_name(new.name, new.section), coalesce(new.description, ''),
          new.professor_id, 'education', new.archived_at)
  returning id into new.space_id;

  insert into public.general_space_members (space_id, user_id, level)
  values (new.space_id, new.professor_id, 'owner');
  perform public.class_sync_restore(prev);

  return new;
end;
$$;

drop trigger if exists classes_space_create on public.classes;
create trigger classes_space_create before insert on public.classes
  for each row execute function public.class_space_create();

-- ---------------------------------------------------------------- changing a class

/**
 * A class keeps its space for life, and only the program admin (or the SQL
 * console) hands a class to another professor. Filling space_id in for the
 * first time is the backfill below, and is the one change allowed.
 */
create or replace function public.class_space_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'A class keeps its own space' using errcode = 'check_violation';
  end if;
  if new.professor_id is distinct from old.professor_id
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin hands a class to another professor'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_space_guard on public.classes;
create trigger classes_space_guard before update on public.classes
  for each row execute function public.class_space_guard();

/** After the class changes or goes: its space does the same. */
create or replace function public.class_space_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  prev := public.class_sync_on();

  if tg_op = 'DELETE' then
    delete from public.general_spaces where id = old.space_id;
    perform public.class_sync_restore(prev);
    return old;
  end if;

  if new.space_id is not null and (
       new.name is distinct from old.name
       or new.section is distinct from old.section
       or new.description is distinct from old.description
       or new.archived_at is distinct from old.archived_at) then
    update public.general_spaces
       set name        = public.class_space_name(new.name, new.section),
           description = coalesce(new.description, ''),
           archived_at = new.archived_at
     where id = new.space_id;
  end if;

  if new.space_id is not null and new.professor_id is distinct from old.professor_id then
    delete from public.general_space_members
     where space_id = new.space_id and user_id = old.professor_id;
    insert into public.general_space_members (space_id, user_id, level)
    values (new.space_id, new.professor_id, 'owner')
    on conflict (space_id, user_id) do update set level = 'owner';
  end if;

  perform public.class_sync_restore(prev);
  return new;
end;
$$;

drop trigger if exists classes_space_follow on public.classes;
create trigger classes_space_follow after update or delete on public.classes
  for each row execute function public.class_space_follow();

-- ---------------------------------------------------------------- the classes that already exist

do $$
declare
  c    record;
  sid  uuid;
  prev text;
begin
  prev := public.class_sync_on();
  for c in select * from public.classes where space_id is null loop
    insert into public.general_spaces
      (name, description, created_by, kind, archived_at, created_at)
    values (public.class_space_name(c.name, c.section), coalesce(c.description, ''),
            c.professor_id, 'education', c.archived_at, c.created_at)
    returning id into sid;

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    values (sid, c.professor_id, 'owner', c.created_at);

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    select sid, m.student_id, 'member', m.joined_at
      from public.class_members m
     where m.class_id = c.id and m.status = 'active'
    on conflict (space_id, user_id) do nothing;

    update public.classes set space_id = sid where id = c.id;
  end loop;
  perform public.class_sync_restore(prev);
end $$;

alter table public.classes alter column space_id set not null;

-- ---------------------------------------------------------------- the General list

/** general-spaces.sql's view, with the kind on the end. Columns only ever append. */
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
         where p.space_id = s.id and p.archived_at is not null)::int as archived_count,
       s.kind
  from public.general_spaces s
  left join public.general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

grant select on public.general_space_overview to authenticated;

commit;

begin;

-- ---------------------------------------------------------------- the roster writes the space

/**
 * class_members stays the roster: join_class, the professor's removals and the
 * restore paths all write it, and its history (removed_at, removed_by) is what
 * recover-work.sql and removed-visible.sql read. This mirrors it into the
 * class's space, so there is one list of who is in, whichever way somebody
 * came in or left.
 */
create or replace function public.class_member_space_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid;
  prev text;
begin
  prev := public.class_sync_on();

  if tg_op in ('UPDATE', 'DELETE') then
    select space_id into sid from public.classes where id = old.class_id;
    if sid is not null and (tg_op = 'DELETE' or new.status <> 'active') then
      delete from public.general_space_members where space_id = sid and user_id = old.student_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
    select space_id into sid from public.classes where id = new.class_id;
    if sid is not null then
      insert into public.general_space_members (space_id, user_id, level)
      values (sid, new.student_id, 'member')
      on conflict (space_id, user_id) do nothing;
    end if;
  end if;

  perform public.class_sync_restore(prev);
  return coalesce(new, old);
end;
$$;

drop trigger if exists class_members_sync_space on public.class_members;
create trigger class_members_sync_space
  after insert or update of status or delete on public.class_members
  for each row execute function public.class_member_space_sync();

-- ---------------------------------------------------------------- guards

create or replace function public.is_education_space(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.general_spaces where id = p_space and kind = 'education');
$$;

/** A space keeps its kind, and a class's space is renamed, archived and deleted by its class. */
create or replace function public.guard_space_kind()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.class_syncing() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'education' then
      raise exception 'Open a class to make an education space.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'A space keeps the kind it was made with.' using errcode = 'check_violation';
  end if;

  if old.kind = 'education' then
    if tg_op = 'DELETE' then
      raise exception 'Delete the class instead. Its space goes with it.'
        using errcode = 'check_violation';
    end if;
    if new.name is distinct from old.name or new.archived_at is distinct from old.archived_at then
      raise exception 'Rename or archive the class instead. Its space follows.'
        using errcode = 'check_violation';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_spaces_kind on public.general_spaces;
create trigger general_spaces_kind before insert or update or delete on public.general_spaces
  for each row execute function public.guard_space_kind();

/**
 * Who sits in a class's space. Students arrive and leave through the roster.
 * The class's professor stays its Owner until the admin hands the class over.
 * Faculty (co-teachers) come and go the General way.
 */
create or replace function public.guard_class_space_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid := case when tg_op = 'DELETE' then old.space_id else new.space_id end;
  prof uuid;
begin
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
    raise exception 'The class''s professor stays its Owner. The program admin can hand the class over.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_space_members_class on public.general_space_members;
create trigger general_space_members_class
  before insert or update of level or delete on public.general_space_members
  for each row execute function public.guard_class_space_member();

/** The side doors: invitations for students, General join codes, General projects. */
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

drop trigger if exists general_space_invitations_class on public.general_space_invitations;
create trigger general_space_invitations_class before insert on public.general_space_invitations
  for each row execute function public.guard_class_space_side();

drop trigger if exists general_space_join_codes_class on public.general_space_join_codes;
create trigger general_space_join_codes_class before insert or update on public.general_space_join_codes
  for each row execute function public.guard_class_space_side();

drop trigger if exists general_projects_class on public.general_projects;
create trigger general_projects_class before insert or update of space_id on public.general_projects
  for each row execute function public.guard_class_space_side();

commit;

begin;

-- ---------------------------------------------------------------- co-teachers

/**
 * Active faculty at Owner or Manager in this space. Reads only the space's
 * members, never `classes`, so the class policies can use it on a row that the
 * same INSERT … RETURNING or UPDATE … RETURNING is still writing.
 */
create or replace function public.teaches_in_space(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_space_members m
      join public.profiles p on p.id = m.user_id
     where m.space_id = p_space
       and m.user_id = auth.uid()
       and m.level in ('owner', 'manager')
       and p.role in ('professor', 'admin')
       and p.status = 'active'
  );
$$;

/**
 * Who teaches a class: its professor, or active faculty the class's space holds
 * at Owner or Manager. Every check below that used to compare professor_id with
 * the caller now asks this instead, so a co-teacher is never half let in.
 * Co-teachers can moderate the class conversation but are not yet its members;
 * phase 3 adds them.
 */
create or replace function public.is_class_professor(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes c
     where c.id = p_class
       and (c.professor_id = auth.uid() or public.teaches_in_space(c.space_id))
  );
$$;

create or replace function public.is_set_professor(p_set uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_sets s
     where s.id = p_set and public.is_class_professor(s.class_id)
  );
$$;

create or replace function public.is_project_professor(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project and public.is_class_professor(p.class_id)
  );
$$;

create or replace function public.is_board_professor(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board and public.is_class_professor(p.class_id)
  );
$$;

create or replace function public.can_read_syllabus(p_resource uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.classes c
      left join public.class_members m
        on m.class_id = c.id and m.student_id = auth.uid() and m.status = 'active'
     where c.syllabus_id = p_resource
       and c.archived_at is null
       and (public.is_class_professor(c.id) or m.student_id is not null)
  );
$$;

create or replace function public.can_moderate_conversation(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
     where c.id = p_conversation
       and public.is_class_professor(coalesce(cl.id, gs.class_id))
  );
$$;

/**
 * removed-visible.sql's version, plus co-teachers: they see the class's
 * students, and the class's students see them.
 */
create or replace function public.shares_class_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.class_members me
      join public.class_members them on them.class_id = me.class_id
      join public.classes c on c.id = me.class_id
     where me.student_id = auth.uid() and me.status = 'active'
       and them.student_id = p_user and them.status = 'active'
       and c.archived_at is null
    union all
    select 1
      from public.classes c
      join public.class_members m on m.class_id = c.id
     where (public.is_class_professor(c.id) and m.student_id = p_user)
        or (c.professor_id = p_user and m.student_id = auth.uid() and m.status = 'active')
    union all
    select 1
      from public.classes c
      join public.general_space_members staff
        on staff.space_id = c.space_id and staff.level in ('owner', 'manager')
     where staff.user_id = p_user
       and (public.is_class_professor(c.id)
            or exists (select 1 from public.class_members m
                        where m.class_id = c.id and m.student_id = auth.uid()
                          and m.status = 'active'))
  );
$$;

/** messages.sql's version: any teacher of the student's class may start the thread. */
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
  if not exists (select 1 from public.profiles where id = me and role = 'professor') then
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

/**
 * classes.sql's policies, plus co-teachers. These read the row's own
 * professor_id/space_id directly rather than calling is_class_professor(id):
 * is_class_professor re-selects from `classes` by id, and `classes`'s own
 * INSERT … RETURNING / UPDATE … RETURNING checks this policy against a row
 * that same command is still writing — a self-select like that can't see it,
 * and the write would be refused for the actual professor too, not just a
 * co-teacher. teaches_in_space(space_id) never touches `classes`, so it has
 * no such blind spot. Deleting a class stays the professor's alone.
 */
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select using (
    professor_id = auth.uid()
    or public.teaches_in_space(space_id)
    or public.is_admin()
    or (archived_at is null and public.is_active_member(id))
  );

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update using (professor_id = auth.uid() or public.teaches_in_space(space_id))
  with check (professor_id = auth.uid() or public.teaches_in_space(space_id));

commit;

begin;

-- ---------------------------------------------------------------- class size limit

/** rate-limit.sql's join_class, plus the class's size limit. */
create or replace function public.join_class(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  target   public.classes%rowtype;
  caller   public.profiles%rowtype;
  existing public.class_members%rowtype;
begin
  select * into caller from public.profiles where id = auth.uid();
  if not found then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if caller.role is distinct from 'student' then
    return jsonb_build_object('result', 'not_student');
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  if not public.rate_limit_ok('class_join', 10, interval '1 hour') then
    return jsonb_build_object('result', 'too_many');
  end if;

  -- Locked, so two students taking the last seat at once queue rather than both fit.
  select * into target from public.classes where upper(code) = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if target.archived_at is not null then
    return jsonb_build_object('result', 'archived');
  end if;

  select * into existing from public.class_members
   where class_id = target.id and student_id = caller.id;

  if found and existing.status = 'removed' then
    return jsonb_build_object('result', 'blocked');
  end if;
  if found then
    return jsonb_build_object('result', 'already_member', 'class_id', target.id);
  end if;
  if not target.join_open then
    return jsonb_build_object('result', 'closed');
  end if;
  if target.student_cap is not null and (
       select count(*) from public.class_members
        where class_id = target.id and status = 'active'
     ) >= target.student_cap then
    return jsonb_build_object('result', 'full');
  end if;

  insert into public.class_members (class_id, student_id) values (target.id, caller.id);
  return jsonb_build_object('result', 'joined', 'class_id', target.id);
end;
$$;

-- ---------------------------------------------------------------- who is a student

/**
 * general-spaces.sql's member lists, plus is_student, so the level pickers can
 * stop offering Owner and Manager for a student. A changed column list needs a
 * drop, not a replace.
 */
drop function if exists public.list_general_space_members(uuid);
create function public.list_general_space_members(p_space uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text,
               level public.general_level, joined_at timestamptz, is_student boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student'
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

drop function if exists public.list_general_project_members(uuid);
create function public.list_general_project_members(p_project uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text,
               level public.general_level, joined_at timestamptz, is_student boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_read_general_project(p_project) then
    raise exception 'You cannot see this project' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student'
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

revoke execute on function public.list_general_space_members(uuid) from public, anon;
revoke execute on function public.list_general_project_members(uuid) from public, anon;
grant execute on function public.list_general_space_members(uuid) to authenticated, service_role;
grant execute on function public.list_general_project_members(uuid) to authenticated, service_role;

commit;
