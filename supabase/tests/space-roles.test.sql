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
  v_i1      uuid := gen_random_uuid();  -- invited, joins as a member
  v_i2      uuid := gen_random_uuid();  -- coordinator of the second space
  v_st2     uuid := gen_random_uuid();  -- a second student
  v_s2      uuid;
  v_p4      uuid;
  v_p5      uuid;
  v_p6      uuid;
  v_team    uuid;
  v_team2   uuid;
  v_team3   uuid;
  v_team4   uuid;
  v_inv     uuid;
  v_space   uuid;
  v_class   uuid;
  v_proj    uuid;
  v_proj2   uuid;
  v_arch    uuid;
  v_t1      uuid;
  v_t2      uuid;
  v_proj3   uuid;
  v_t3      uuid;
  v_t4      uuid;
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
      (v_teacher, 'zz-sr-teacher@example.test'),
      (v_i1,      'zz-sr-i1@example.test'),
      (v_i2,      'zz-sr-i2@example.test'),
      (v_st2,     'zz-sr-st2@example.test')
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
    (v_teacher, 'zz-sr-teacher@example.test', 'Zz', 'Srteacher', 'member',  'active', true,  false),
    (v_i1,      'zz-sr-i1@example.test',      'Zz', 'Sri1',      'member',  'active', false, false),
    (v_i2,      'zz-sr-i2@example.test',      'Zz', 'Sri2',      'member',  'active', false, false),
    (v_st2,     'zz-sr-st2@example.test',     'Zz', 'Srst2',     'student', 'active', false, false)
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

  -- ---------------------------------------------------------------- a caller who is not on the project
  perform pg_temp.act_as(v_pm);
  v_proj3 := (public.create_general_project('Zz SR project three', '', null, null, null, null, v_space)).id;
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values
    (v_proj3, v_member, 'member'), (v_proj3, v_old, 'member'), (v_proj3, v_qa, 'member');
  update public.general_members set role = 'coordinator' where project_id = v_proj3 and user_id = v_pm;
  delete from public.general_members where project_id = v_proj3 and user_id = v_pm;
  insert into public.general_tasks (project_id, title) values (v_proj3, 'Zz SR task three')
    returning id into v_t3;
  insert into public.general_tasks (project_id, title) values (v_proj3, 'Zz SR task four')
    returning id into v_t4;
  insert into public.general_task_assignees (task_id, project_id, user_id) values
    (v_t3, v_proj3, v_member), (v_t4, v_proj3, v_qa);

  perform pg_temp.claim_as(v_coord);
  perform pg_temp.must_be('preview: caller off the project still counts it',
    (select project_count = 2 and qa_start_count = 1 from public.preview_general_space_role(v_space, v_member, 'qa')));
  perform public.set_general_space_role(v_space, v_member, 'qa');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator off the project: role changes',
    (select role = 'qa' from public.general_members where project_id = v_proj3 and user_id = v_member));
  perform pg_temp.must_be('coordinator off the project: task released',
    (select count(*) = 0 from public.general_task_assignees where project_id = v_proj3 and user_id = v_member));
  perform pg_temp.claim_as(v_coord);
  perform pg_temp.must_be('preview: caller off a project that already has qa counts no new gate',
    (select qa_start_count = 0 from public.preview_general_space_role(v_space, v_old, 'qa')));
  perform pg_temp.claim_as(v_pm);
  perform public.set_general_space_role(v_space, v_qa, 'stakeholder');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('space pm off the project: role changes',
    (select role = 'stakeholder' from public.general_members where project_id = v_proj3 and user_id = v_qa));
  perform pg_temp.must_be('space pm off the project: task released',
    (select count(*) = 0 from public.general_task_assignees where project_id = v_proj3 and user_id = v_qa));

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

  -- ---------------------------------------------------------------- invitations and joining
  perform pg_temp.act_as(v_pm);
  v_s2 := (public.create_general_space('Zz SR invite space', '')).id;
  v_p4 := (public.create_general_project('Zz SR project four', '', null, null, null, null, v_s2)).id;
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, role) values
    (v_s2, v_coord, 'coordinator'), (v_s2, v_i2, 'coordinator'), (v_s2, v_student, 'stakeholder');
  insert into public.general_members (project_id, user_id, role) values (v_p4, v_member, 'member');
  -- Joining a project already put them in the space; take that row away so the invitation is theirs to accept.
  delete from public.general_space_members where space_id = v_s2 and user_id = v_member;

  perform pg_temp.act_as(v_pm);
  v_inv := (public.invite_general_space_member(v_s2, v_member, 'qa')).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('invite carries a role',
    (select invited_role = 'qa' from public.general_space_invitations where id = v_inv));
  perform pg_temp.act_as(v_member);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting gives the role',
    (select role = 'qa' from public.general_space_members where space_id = v_s2 and user_id = v_member));
  perform pg_temp.must_be('accepting starts no cascade',
    (select role = 'member' from public.general_members where project_id = v_p4 and user_id = v_member));

  perform pg_temp.act_as(v_coord);
  perform public.invite_general_space_member(v_s2, v_i1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator can invite',
    exists (select 1 from public.general_space_invitations
             where space_id = v_s2 and invitee = v_i1 and invited_by = v_coord
               and invited_role = 'member' and status = 'pending'));
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_be('coordinator can list invitations',
    (select count(*) from public.list_general_space_invitations(v_s2)) = 1);
  perform pg_temp.must_refuse_with('coordinator cannot invite a coordinator',
    format($q$select public.invite_general_space_member(%L, %L, 'coordinator')$q$, v_s2, v_i1), 'project manager');
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('invite as pm refused',
    format($q$select public.invite_general_space_member(%L, %L, 'pm')$q$, v_s2, v_i1), 'hand over');
  perform pg_temp.must_refuse_with('co-owner invite refused on work',
    format($q$select public.invite_to_general_space(%L, %L)$q$, v_s2, v_i1), 'hand over');
  perform pg_temp.act_as(v_teacher);
  perform public.invite_to_general_space(v_class, v_i1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('class space invite still works',
    exists (select 1 from public.general_space_invitations where space_id = v_class and invitee = v_i1));

  -- Joining a project by code.
  perform pg_temp.act_as(v_coord);
  v_p5 := (public.create_general_project('Zz SR project five', '', null, null, null, null, v_s2)).id;
  perform pg_temp.act_as_service();
  insert into public.general_join_codes (project_id, code, open) values (v_p5, 'ZZSRCODE5', true)
  on conflict (project_id) do update set code = excluded.code, open = true;
  perform pg_temp.act_as(v_i2);
  perform public.join_general_project('ZZSRCODE5');
  perform pg_temp.act_as(v_pm);
  perform public.join_general_project('ZZSRCODE5');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('code join uses the space role',
    (select role = 'coordinator' from public.general_members where project_id = v_p5 and user_id = v_i2));
  perform pg_temp.must_be('space pm joining by code is coordinator',
    (select role = 'coordinator' from public.general_members where project_id = v_p5 and user_id = v_pm));

  insert into public.general_space_members (space_id, user_id, role) values (v_s2, v_i1, 'member');
  perform pg_temp.act_as(v_coord);
  perform public.invite_to_general_project(v_p5, v_i1, 'qa');
  perform pg_temp.act_as(v_i1);
  perform public.join_general_project('ZZSRCODE5');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('code join: pending invitation wins',
    (select role = 'qa' from public.general_members where project_id = v_p5 and user_id = v_i1));

  -- Inviting a coordinator to a project.
  insert into public.general_members (project_id, user_id, role) values (v_p4, v_coord, 'coordinator');
  perform pg_temp.act_as(v_coord);
  perform public.invite_to_general_project(v_p4, v_i2, 'coordinator');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('project coordinator may invite a space coordinator',
    exists (select 1 from public.general_invitations
             where project_id = v_p4 and invitee = v_i2 and role = 'coordinator' and status = 'pending'));
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('project coordinator cannot invite other coordinators',
    format($q$select public.invite_to_general_project(%L, %L, 'coordinator')$q$, v_p4, v_i1), 'project manager');
  perform pg_temp.act_as_service();

  -- A project made from a space team takes each person's space role.
  insert into public.general_space_teams (space_id, name, created_by)
  values (v_s2, 'Zz SR team', v_pm) returning id into v_team;
  insert into public.general_space_team_members (team_id, space_id, user_id) values
    (v_team, v_s2, v_pm), (v_team, v_s2, v_student), (v_team, v_s2, v_i2), (v_team, v_s2, v_member);
  perform pg_temp.act_as(v_pm);
  v_p6 := (public.create_general_project('Zz SR project six', '', null, null, null, null, v_s2, v_team)).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('team seed uses space roles',
    (select role = 'stakeholder' from public.general_members where project_id = v_p6 and user_id = v_student)
    and (select role = 'coordinator' from public.general_members where project_id = v_p6 and user_id = v_i2)
    and (select role = 'qa' from public.general_members where project_id = v_p6 and user_id = v_member));
  perform pg_temp.must_be('team seed keeps the creator as pm',
    (select role = 'pm' from public.general_members where project_id = v_p6 and user_id = v_pm));
  perform pg_temp.must_be('team seed adds a stakeholder to the team',
    exists (select 1 from public.general_team_members where project_id = v_p6 and user_id = v_student));

  -- A coordinator without the Project manager switch invites a student; a member cannot.
  perform pg_temp.act_as(v_i2);
  perform public.invite_general_space_member(v_s2, v_st2, 'qa');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator without the switch invites a student',
    exists (select 1 from public.general_space_invitations
             where space_id = v_s2 and invitee = v_st2 and invited_by = v_i2));
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_refuse_with('a plain member cannot invite a student',
    format($q$select public.invite_general_space_member(%L, %L)$q$, v_s2, v_st2), 'permission');
  perform pg_temp.act_as(v_st2);
  perform pg_temp.must_be('the invitee list returns the role',
    (select invited_role = 'qa' from public.list_my_general_space_invitations() where space_id = v_s2));
  perform pg_temp.act_as_service();

  -- Accepting over an existing seat: a Member seat takes the role, any other seat stands.
  update public.general_space_invitations set invited_role = 'stakeholder'
   where space_id = v_s2 and invitee = v_i1 and status = 'pending' returning id into v_inv;
  perform pg_temp.act_as(v_i1);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting over a member seat takes the invited role',
    (select role = 'stakeholder' from public.general_space_members where space_id = v_s2 and user_id = v_i1));
  insert into public.general_space_invitations (space_id, invitee, invited_by, invited_level, invited_role)
  values (v_s2, v_i2, v_pm, 'member', 'qa') returning id into v_inv;
  perform pg_temp.act_as(v_i2);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting over a coordinator seat keeps coordinator',
    (select role = 'coordinator' from public.general_space_members where space_id = v_s2 and user_id = v_i2));

  -- ---------------------------------------------------------------- details, teams and removing people
  -- v_i2 is a coordinator of v_s2 with no Project manager switch, on neither the second team nor project four. v_i1 is a plain member with no team.
  perform pg_temp.act_as(v_i2);
  perform public.update_general_space(v_s2, 'New name', 'Zz');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator edits details',
    (select name = 'New name' from public.general_spaces where id = v_s2));
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_refuse_with('member cannot edit details',
    format($q$select public.update_general_space(%L, 'Nope', '')$q$, v_s2), 'permission');
  perform pg_temp.act_as(v_i2);
  perform pg_temp.must_refuse_with('coordinator cannot archive the space',
    format($q$select public.archive_general_space(%L, true)$q$, v_s2), 'project manager');
  perform pg_temp.act_as(v_old);
  perform pg_temp.must_refuse_with('class space archive keeps its text',
    format($q$select public.archive_general_space(%L, true)$q$, v_class), 'Owner archives') ;
  perform pg_temp.act_as_service();

  -- The second team has only the project manager on it.
  perform pg_temp.act_as(v_pm);
  v_team2 := (public.create_general_space_team(v_s2, 'Zz SR team two')).id;
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_be('member reads every team',
    (select count(*) = 2 from public.list_general_space_teams(v_s2)));
  perform pg_temp.must_be('member reads every live team, other overload',
    (select count(*) = 2 from public.list_general_space_teams(v_s2, false)));
  perform pg_temp.must_be('not on the team: my_level null',
    (select my_level is null from public.list_general_space_teams(v_s2) where id = v_team2));
  perform pg_temp.must_be('not on the team: my_level null, other overload',
    (select my_level is null from public.list_general_space_teams(v_s2, false) where id = v_team2));
  perform pg_temp.must_be('member reads team people',
    (select count(*) > 0 from public.list_general_space_team_members(v_s2)));
  perform pg_temp.must_be('member reads every team people',
    (select count(distinct team_id) = 2 from public.list_general_space_team_members(v_s2)));
  perform pg_temp.must_be('member reads the team rows',
    (select count(*) = 2 from public.general_space_teams where space_id = v_s2));
  perform pg_temp.act_as_service();
  update public.general_space_teams set archived_at = now(), trashed_at = now() where id = v_team2;
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_be('a trashed team stays out of the archive-page list',
    (select count(*) = 1 from public.list_general_space_teams(v_s2, false)));
  perform pg_temp.act_as_service();
  update public.general_space_teams set archived_at = null where id = v_team2;

  perform pg_temp.act_as(v_i2);
  v_team3 := (public.create_general_space_team(v_s2, 'Zz SR coordinator team')).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator creates a team',
    exists (select 1 from public.general_space_teams where id = v_team3 and created_by = v_i2));
  update public.profiles set can_manage_projects = true where id = v_i1;
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_refuse_with('switch holder who is a member cannot create',
    format($q$select public.create_general_space_team(%L, 'Zz SR nope')$q$, v_s2), 'coordinator');

  perform pg_temp.act_as(v_i2);
  perform public.update_general_space_team(v_team2, 'Renamed', '');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator edits a team they are not on',
    (select name = 'Renamed' from public.general_space_teams where id = v_team2));
  insert into public.general_space_team_members (team_id, space_id, user_id, level)
  values (v_team, v_s2, v_i1, 'owner');
  perform pg_temp.act_as(v_i1);
  perform pg_temp.must_refuse_with('team owner who is a member cannot edit',
    format($q$select public.update_general_space_team(%L, 'Nope', '')$q$, v_team), 'manage');

  perform pg_temp.act_as(v_pm);
  perform public.remove_general_space_team_member(v_team3, v_i2);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('pm removes the only team owner',
    not exists (select 1 from public.general_space_team_members where team_id = v_team3 and user_id = v_i2));
  perform pg_temp.act_as(v_member);
  perform public.remove_general_space_team_member(v_team, v_member);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('member can still leave a team',
    not exists (select 1 from public.general_space_team_members where team_id = v_team and user_id = v_member));

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('project seed needs team membership',
    format($q$select public.create_general_project('Zz SR seed', '', null, null, null, null, %L, %L)$q$, v_s2, v_team),
    'team');

  -- Removing people.
  perform pg_temp.act_as(v_i2);
  perform pg_temp.must_refuse_with('coordinator cannot remove the pm',
    format($q$select public.remove_general_space_member(%L, %L)$q$, v_s2, v_pm), 'project manager');
  perform pg_temp.must_refuse_with('coordinator cannot remove a coordinator',
    format($q$select public.remove_general_space_member(%L, %L)$q$, v_s2, v_coord), 'project manager');
  perform public.remove_general_space_member(v_s2, v_i1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('coordinator removes a member',
    not exists (select 1 from public.general_space_members where space_id = v_s2 and user_id = v_i1));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('pm cannot leave without handing over',
    format($q$select public.remove_general_space_member(%L, %L)$q$, v_s2, v_pm), 'hand over');
  perform pg_temp.act_as(v_coord);
  perform public.remove_general_space_member(v_s2, v_coord);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a coordinator can still leave',
    not exists (select 1 from public.general_space_members where space_id = v_s2 and user_id = v_coord));

  -- A student who is a coordinator creates a team and sits on it as a member.
  update public.general_space_members set role = 'coordinator' where space_id = v_s2 and user_id = v_student;
  perform pg_temp.act_as(v_student);
  v_team4 := (public.create_general_space_team(v_s2, 'Zz SR student coordinator team')).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('student coordinator creates a team',
    exists (select 1 from public.general_space_teams where id = v_team4 and created_by = v_student));
  perform pg_temp.must_be('...and sits on it as a member',
    (select level = 'member' from public.general_space_team_members where team_id = v_team4 and user_id = v_student));
  perform pg_temp.act_as(v_student);
  perform public.update_general_space_team(v_team4, 'Zz SR student renamed', '');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and manages it as a coordinator',
    (select name = 'Zz SR student renamed' from public.general_space_teams where id = v_team4));

  -- A coordinator reads only the projects they are on.
  perform pg_temp.act_as(v_i2);
  perform pg_temp.must_be('coordinator gets no read of a project they are not on',
    not public.can_read_general_project(v_p4));
  perform pg_temp.must_be('coordinator on the project still reads it',
    public.can_read_general_project(v_p5));
  perform pg_temp.act_as_service();
end;
$$;

rollback;
