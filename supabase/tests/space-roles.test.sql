-- supabase/tests/space-roles.test.sql
-- Work-space roles: the column, the level sync, the backfill and the read paths.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/space-roles.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.claim_as(p_user uuid) returns void
language plpgsql as $$
begin
  -- Signed-in claims without the authenticated role: no policy exists for member writes
  -- (they go through RPCs), but the triggers read auth.uid().
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_pm      uuid := gen_random_uuid();  -- creates the work space, its project manager
  v_old     uuid := gen_random_uuid();  -- inserted the older way, with level owner
  v_member  uuid := gen_random_uuid();  -- plain member
  v_coord   uuid := gen_random_uuid();  -- gets coordinator
  v_qa      uuid := gen_random_uuid();  -- gets qa
  v_student uuid := gen_random_uuid();  -- a student
  v_teacher uuid := gen_random_uuid();  -- owner of the class space
  v_space   uuid;
  v_class   uuid;
  v_proj    uuid;
  v_snap_n  int;
  n         int;
  s         text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,      'zz-sr-pm@example.test'),
      (v_old,     'zz-sr-old@example.test'),
      (v_member,  'zz-sr-member@example.test'),
      (v_coord,   'zz-sr-coord@example.test'),
      (v_qa,      'zz-sr-qa@example.test'),
      (v_student, 'zz-sr-student@example.test'),
      (v_teacher, 'zz-sr-teacher@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,      'zz-sr-pm@example.test',      'Zz', 'Srpm',      'member',  'active', false, true),
    (v_old,     'zz-sr-old@example.test',     'Zz', 'Srold',     'member',  'active', false, false),
    (v_member,  'zz-sr-member@example.test',  'Zz', 'Srmember',  'member',  'active', false, false),
    (v_coord,   'zz-sr-coord@example.test',   'Zz', 'Srcoord',   'member',  'active', false, false),
    (v_qa,      'zz-sr-qa@example.test',      'Zz', 'Srqa',      'member',  'active', false, false),
    (v_student, 'zz-sr-student@example.test', 'Zz', 'Srstudent', 'student', 'active', false, false),
    (v_teacher, 'zz-sr-teacher@example.test', 'Zz', 'Srteacher', 'member',  'active', true,  false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  insert into public.notification_prefs (user_id)
  select u from unnest(array[v_coord]) as u
  on conflict (user_id) do update set project_updates = true;

  -- Snapshot of project roles, to show a rerun leaves them alone.
  create temporary table zz_sr_roles on commit drop as
    select project_id, user_id, role from public.general_members;
  select count(*) into v_snap_n from zz_sr_roles;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz SR space', '')).id;
  v_proj := (public.create_general_project('Zz SR project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_member, 'member'), (v_space, v_coord, 'member'),
    (v_space, v_qa, 'member'), (v_space, v_student, 'member');

  -- Older insert path: level only, owner. Another pm cannot exist, so drop the creator's
  -- pm for the moment by moving it aside, then put it back.
  update public.general_space_members set role = 'coordinator'
   where space_id = v_space and user_id = v_pm;
  insert into public.general_space_members (space_id, user_id, level) values (v_space, v_old, 'owner');
  perform pg_temp.must_be('older insert with level owner gets pm',
    (select role = 'pm' and level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_old));
  update public.general_space_members set role = 'member' where space_id = v_space and user_id = v_old;
  update public.general_space_members set role = 'pm' where space_id = v_space and user_id = v_pm;

  -- Backfill: put rows back to the pre-launch shape (null role), then run the statement.
  alter table public.general_space_members disable trigger general_space_members_a_sync_role;
  update public.general_space_members set role = null, level = 'owner'
   where space_id = v_space and user_id = v_pm;
  update public.general_space_members set role = null where space_id = v_space and user_id = v_member;
  alter table public.general_space_members enable trigger general_space_members_a_sync_role;
  update public.general_space_members m
     set role = case m.level when 'owner' then 'pm' when 'manager' then 'coordinator' else 'member' end::public.general_role
   where m.role is null
     and exists (select 1 from public.general_spaces s where s.id = m.space_id and s.kind = 'work');
  perform pg_temp.must_be('owner backfilled to pm',
    (select role = 'pm' and level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_pm));
  perform pg_temp.must_be('member backfilled to member',
    (select role = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_member));

  -- Class space rows keep a null role.
  insert into public.general_spaces (name, kind, created_by)
  values ('Zz SR class space', 'education', v_teacher) returning id into v_class;
  insert into public.general_space_members (space_id, user_id, level) values
    (v_class, v_teacher, 'owner'), (v_class, v_student, 'member');
  perform pg_temp.must_be('class space row keeps null role',
    (select bool_and(role is null) and count(*) = 2 from public.general_space_members
      where space_id = v_class));

  -- Roles derive levels.
  update public.general_space_members set role = 'coordinator' where space_id = v_space and user_id = v_coord;
  perform pg_temp.must_be('role coordinator derives manager',
    (select level = 'manager' from public.general_space_members where space_id = v_space and user_id = v_coord));
  update public.general_space_members set role = 'qa' where space_id = v_space and user_id = v_qa;
  perform pg_temp.must_be('role qa derives member',
    (select level = 'member' from public.general_space_members where space_id = v_space and user_id = v_qa));

  perform pg_temp.must_refuse_with('second pm refused',
    format($q$update public.general_space_members set role = 'pm' where space_id = %L and user_id = %L$q$,
           v_space, v_member),
    'general_space_members_one_pm');

  -- A signed-in caller: a student can be a coordinator in a work space, not the pm.
  perform pg_temp.claim_as(v_pm);
  update public.general_space_members set role = 'coordinator'
   where space_id = v_space and user_id = v_student;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('student can be coordinator in a work space',
    (select role = 'coordinator' from public.general_space_members
      where space_id = v_space and user_id = v_student));
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('student cannot be pm',
    format($q$update public.general_space_members set role = 'pm' where space_id = %L and user_id = %L$q$,
           v_space, v_student),
    'student');
  perform pg_temp.act_as_service();

  -- The class-space student rule still holds.
  perform pg_temp.claim_as(v_teacher);
  perform pg_temp.must_refuse_with('class space student level rule still holds',
    format($q$update public.general_space_members set level = 'manager' where space_id = %L and user_id = %L$q$,
           v_class, v_student),
    'student can only be a member');
  perform pg_temp.act_as_service();

  -- Read paths.
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_be('overview shows my_role',
    (select my_role = 'coordinator' from public.general_space_overview where id = v_space));
  perform pg_temp.must_be('members list returns role',
    (select role = 'qa' from public.list_general_space_members(v_space) where user_id = v_qa));
  perform pg_temp.act_as_service();

  -- The notice names the role.
  perform pg_temp.claim_as(v_pm);
  update public.general_space_members set role = 'qa' where space_id = v_space and user_id = v_coord;
  update public.general_space_members set role = 'coordinator' where space_id = v_space and user_id = v_coord;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('space role notice names the role',
    exists (select 1 from public.notifications
             where user_id = v_coord and type = 'membership_changed'
               and general_space_id = v_space and preview = 'You are now a coordinator'));

  -- default role for a project: pm reads as coordinator, a class board has none.
  perform pg_temp.must_be('default role maps pm to coordinator',
    public.general_space_default_role(v_proj, v_pm) = 'coordinator');
  perform pg_temp.must_be('default role keeps qa',
    public.general_space_default_role(v_proj, v_qa) = 'qa');

  -- Rerun: the exact backfill statement keeps a set role and leaves project roles.
  update public.general_space_members m
     set role = case m.level when 'owner' then 'pm' when 'manager' then 'coordinator' else 'member' end::public.general_role
   where m.role is null
     and exists (select 1 from public.general_spaces s where s.id = m.space_id and s.kind = 'work');
  perform pg_temp.must_be('rerun keeps a set role',
    (select role = 'qa' from public.general_space_members where space_id = v_space and user_id = v_qa));
  perform pg_temp.must_be('rerun leaves project roles',
    (select count(*) from public.general_members g
       join zz_sr_roles z on z.project_id = g.project_id and z.user_id = g.user_id
      where g.role is distinct from z.role) = 0);
end;
$$;

rollback;
