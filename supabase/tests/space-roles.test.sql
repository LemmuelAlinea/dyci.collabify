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
  v_proj2   uuid;
  v_arch    uuid;
  v_t1      uuid;
  v_t2      uuid;
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

  -- ---------------------------------------------------------------- set a space role
  perform pg_temp.act_as(v_pm);
  v_proj2 := (public.create_general_project('Zz SR project two', '', null, null, null, null, v_space)).id;
  v_arch  := (public.create_general_project('Zz SR archived', '', null, null, null, null, v_space)).id;
  perform pg_temp.act_as_service();

  -- v_member sits on the first project and on a project that is archived.
  insert into public.general_members (project_id, user_id, role) values
    (v_proj, v_member, 'member'), (v_arch, v_member, 'member');
  update public.general_projects set archived_at = now() where id = v_arch;
  insert into public.general_grants (project_id, user_id, permission) values
    (v_proj, v_member, 'manage_tasks');
  insert into public.general_tasks (project_id, title) values (v_proj, 'Zz SR task one')
    returning id into v_t1;
  insert into public.general_tasks (project_id, title) values (v_proj, 'Zz SR task two')
    returning id into v_t2;
  insert into public.general_task_assignees (task_id, project_id, user_id) values
    (v_t1, v_proj, v_member), (v_t2, v_proj, v_member);

  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_be('preview counts live projects only',
    (select project_count = 1 from public.preview_general_space_role(v_space, v_member, 'qa')));
  perform pg_temp.must_be('preview counts tasks',
    (select task_count = 2 from public.preview_general_space_role(v_space, v_member, 'qa')));
  perform pg_temp.must_be('preview counts new qa gates',
    (select qa_start_count = 1 from public.preview_general_space_role(v_space, v_member, 'qa')));

  perform pg_temp.must_be('set returns the projects changed',
    public.set_general_space_role(v_space, v_member, 'qa') = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('space row takes the role',
    (select role = 'qa' from public.general_space_members where space_id = v_space and user_id = v_member));
  perform pg_temp.must_be('member moved to qa on the live project',
    (select role = 'qa' from public.general_members where project_id = v_proj and user_id = v_member));
  perform pg_temp.must_be('qa releases held tasks',
    (select count(*) = 0 from public.general_task_assignees where project_id = v_proj and user_id = v_member));
  perform pg_temp.must_be('grants cleared off member',
    (select count(*) = 0 from public.general_grants where project_id = v_proj and user_id = v_member));

  -- Coordinator on both live projects; the archived one is left alone.
  insert into public.general_members (project_id, user_id, role) values (v_proj2, v_member, 'member');
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_be('set returns two projects',
    public.set_general_space_role(v_space, v_member, 'coordinator') = 2);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('member set to coordinator on both live projects',
    (select count(*) = 2 and bool_and(role = 'coordinator') from public.general_members
      where user_id = v_member and project_id in (v_proj, v_proj2)));
  perform pg_temp.must_be('archived project skipped',
    (select role = 'member' from public.general_members where project_id = v_arch and user_id = v_member));

  update public.general_members set role = 'qa' where project_id = v_proj2 and user_id = v_member;
  perform pg_temp.must_be('a project override stands until the next change',
    (select role = 'qa' from public.general_members where project_id = v_proj2 and user_id = v_member));

  -- A space coordinator moves a member to qa.
  insert into public.general_members (project_id, user_id, role) values (v_proj, v_old, 'member');
  perform pg_temp.claim_as(v_coord);
  perform public.set_general_space_role(v_space, v_old, 'qa');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator moves member to qa',
    (select role = 'qa' from public.general_members where project_id = v_proj and user_id = v_old));

  -- A space coordinator leaves project coordinators alone; the space pm overwrites them.
  insert into public.general_members (project_id, user_id, role) values
    (v_proj, v_qa, 'coordinator'), (v_proj2, v_qa, 'qa');
  perform pg_temp.claim_as(v_coord);
  perform public.set_general_space_role(v_space, v_qa, 'member');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('space coordinator leaves project coordinators',
    (select role = 'coordinator' from public.general_members where project_id = v_proj and user_id = v_qa));
  perform pg_temp.must_be('coordinator still moves the other project',
    (select role = 'member' from public.general_members where project_id = v_proj2 and user_id = v_qa));
  perform pg_temp.claim_as(v_pm);
  perform public.set_general_space_role(v_space, v_qa, 'qa');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('space pm overwrites project coordinators',
    (select role = 'qa' from public.general_members where project_id = v_proj and user_id = v_qa));

  -- Refusals.
  perform pg_temp.claim_as(v_coord);
  perform pg_temp.must_refuse_with('coordinator cannot make a coordinator',
    format($q$select public.set_general_space_role(%L, %L, 'coordinator')$q$, v_space, v_qa), 'project manager');
  perform pg_temp.must_refuse_with('coordinator cannot change a coordinator',
    format($q$select public.set_general_space_role(%L, %L, 'qa')$q$, v_space, v_student), 'project manager');
  perform pg_temp.claim_as(v_old);
  perform pg_temp.must_refuse_with('member cannot set roles',
    format($q$select public.set_general_space_role(%L, %L, 'qa')$q$, v_space, v_qa), 'permission');
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('pm through set role refused',
    format($q$select public.set_general_space_role(%L, %L, 'pm')$q$, v_space, v_qa), 'hand over');
  perform pg_temp.must_refuse_with('cannot change the space pm',
    format($q$select public.set_general_space_role(%L, %L, 'qa')$q$, v_space, v_pm), 'hand over');
  perform pg_temp.act_as_service();
  update public.general_spaces set archived_at = now() where id = v_space;
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('archived space refused',
    format($q$select public.set_general_space_role(%L, %L, 'qa')$q$, v_space, v_member), 'archived');
  perform pg_temp.act_as_service();
  update public.general_spaces set archived_at = null where id = v_space;

  -- A caller who was a coordinator and is now a member: the gate reads the current row.
  update public.general_space_members set role = 'member' where space_id = v_space and user_id = v_coord;
  perform pg_temp.claim_as(v_coord);
  perform pg_temp.must_refuse_with('stale coordinator refused',
    format($q$select public.set_general_space_role(%L, %L, 'qa')$q$, v_space, v_qa), 'permission');
  perform pg_temp.act_as_service();
  update public.general_space_members set role = 'coordinator' where space_id = v_space and user_id = v_coord;

  -- The level rpc: refused on a work space, still works on a class space.
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('level rpc refused on a work space',
    format($q$select public.set_general_space_level(%L, %L, 'manager')$q$, v_space, v_qa), 'role');
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values (v_class, v_old, 'member');
  perform pg_temp.claim_as(v_teacher);
  perform public.set_general_space_level(v_class, v_old, 'manager');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('class space level rpc still works',
    (select level = 'manager' from public.general_space_members where space_id = v_class and user_id = v_old));

  -- A project pm is not touched by a space role change.
  update public.general_members set role = 'coordinator' where project_id = v_proj2 and user_id = v_pm;
  update public.general_members set role = 'pm' where project_id = v_proj2 and user_id = v_member;
  perform pg_temp.claim_as(v_pm);
  perform public.set_general_space_role(v_space, v_member, 'member');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('project pm stays pm',
    (select role = 'pm' from public.general_members where project_id = v_proj2 and user_id = v_member));

  -- ---------------------------------------------------------------- hand over
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('hand over to a student',
    format($q$select public.hand_over_general_space(%L, %L)$q$, v_space, v_student), 'student');
  perform pg_temp.must_refuse_with('hand over without the switch',
    format($q$select public.hand_over_general_space(%L, %L)$q$, v_space, v_coord), 'Project manager turned on');
  perform pg_temp.act_as_service();
  update public.profiles set can_manage_projects = true where id = v_coord;
  create temporary table zz_sr_before on commit drop as
    select project_id, user_id, role from public.general_members;
  perform pg_temp.claim_as(v_pm);
  perform public.hand_over_general_space(v_space, v_coord);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('hand over swaps',
    (select role from public.general_space_members where space_id = v_space and user_id = v_pm) = 'coordinator'
    and (select role from public.general_space_members where space_id = v_space and user_id = v_coord) = 'pm');
  perform pg_temp.must_be('hand over changes no project role',
    (select count(*) from public.general_members g
       join zz_sr_before z on z.project_id = g.project_id and z.user_id = g.user_id
      where g.role is distinct from z.role) = 0);
  perform pg_temp.claim_as(v_pm);
  perform pg_temp.must_refuse_with('only the pm hands over',
    format($q$select public.hand_over_general_space(%L, %L)$q$, v_space, v_pm), 'project manager');
  perform pg_temp.act_as_service();
end;
$$;

rollback;
